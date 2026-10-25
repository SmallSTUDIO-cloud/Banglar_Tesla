/**
 * Bangla Road-Rage Encounter System (Milestone 2).
 *
 * Triggered ONLY when the player slams into a private passenger sedan (`car`)
 * above the high-impact speed threshold. Never triggers on rickshaws, CNGs,
 * buses, vans, trucks, or motorbikes, and enforces strict cooldown & non-overlap
 * guards so encounters never stack.
 */

import * as THREE from 'three';
import { getLocale } from '../core/i18n';
import { PassengerActor } from '../missions/actors';
import type { TrafficSystem } from './traffic';
import type { BanglaSpeechService } from '../audio/speech';
import type { AudioEngine } from '../audio/audio';

export type RoadRageState = 'idle' | 'exiting' | 'pursuing' | 'confronting' | 'scuffling';

export const ROADRAGE_DRIVER_LINE = 'ওই হারামজাদা, দাঁড়া!';
export const ROADRAGE_DRIVER_LINE_EN = 'Hey maniac, pull right over!';
export const ROADRAGE_PLAYER_LINE = 'মাফ করে দেন ভাই, ভুলে লেগে গেছে!';
export const ROADRAGE_PLAYER_LINE_EN = 'Sorry brother, it was an honest mistake!';
export const ROADRAGE_ESCAPED_TEXT = 'পালাতে পেরেছেন!';
export const ROADRAGE_PAY_LABEL = '১০০ টাকা দিয়ে মিটমাট করুন';
export const ROADRAGE_REFUSE_LABEL = 'দেব না';
export const ROADRAGE_SETTLE_COST = 100;

/** World-space separation (m) required to tick the 5-second escape countdown. */
export const ESCAPE_DISTANCE_M = 17.5;
/** Uninterrupted duration (s) beyond ESCAPE_DISTANCE_M needed to escape. */
export const ESCAPE_HOLD_SECONDS = 5.0;
/** Catch radius (m) around player rickshaw where the pursuing driver intercepts. */
export const CATCH_RADIUS_M = 2.25;
/** Pursuing driver sprint speed (m/s) — ~15.7 km/h. */
export const DRIVER_SPRINT_SPEED = 4.35;

export interface RoadRageCallbacks {
  heightAt: (x: number, z: number) => number;
  getDialogueSettings: () => { volume: number; muted: boolean; subtitles: boolean };
  onAlertBanner: (headline: string | null, subline?: string, escapingSec?: number | null) => void;
  onSubtitle: (speakerKey: string, banglaLine: string) => void;
  onEscaped: () => void;
  onOpenConfrontation: () => void;
  onCloseConfrontation: () => void;
  onScuffleStart: () => void;
  onScuffleComplete: () => void;
}

export class RoadRageSystem {
  private actor: PassengerActor;
  private state: RoadRageState = 'idle';
  private carAgentIdx = -1;
  private stateTimer = 0;
  private escapeRemaining = ESCAPE_HOLD_SECONDS;
  private cooldownTimer = 0;
  private driverDistance = 0;
  private driverSpoken = false;
  private playerSpoken = false;

  constructor(
    scene: THREE.Scene,
    private traffic: TrafficSystem,
    private speech: BanglaSpeechService,
    private audio: AudioEngine,
    private cb: RoadRageCallbacks,
  ) {
    this.actor = new PassengerActor({
      id: 'office',
      whoKey: 'roadrage.speaker.driver',
      greetKey: 'roadrage.line.driver',
      moodBias: 0,
      patience: 1,
      colors: {
        shirt: '#e2e8f0',
        lower: '#1e293b',
        skin: '#8d5b3e',
        accent: '#dc2626',
      },
      skirt: 0,
      bag: false,
    });
    this.actor.setVisible(false);
    scene.add(this.actor.group);
  }

  get currentState(): RoadRageState {
    return this.state;
  }

  get isActive(): boolean {
    return this.state !== 'idle';
  }

  /** True when player controls must be locked (confrontation modal or 1.2s scuffle). */
  get isControlLocked(): boolean {
    return this.state === 'confronting' || this.state === 'scuffling';
  }

  get escapeSecondsLeft(): number {
    return this.escapeRemaining;
  }

  get currentDistance(): number {
    return this.driverDistance;
  }

  get escapeSecondsRemaining(): number {
    return this.escapeRemaining;
  }

  get cooldownRemaining(): number {
    return this.cooldownTimer;
  }

  get driverPosition(): { x: number; z: number } {
    return { x: this.actor.group.position.x, z: this.actor.group.position.z };
  }

  /** Prewarm NPC meshes at boot so spawning never triggers shader compilation. */
  withPrewarmState(run: () => void): void {
    const prev = this.actor.group.visible;
    this.actor.setVisible(true);
    try {
      run();
    } finally {
      this.actor.setVisible(prev);
    }
  }

  /**
   * Attempt to start a road-rage encounter after colliding with `agentIndex`.
   * Strictly checks `canTriggerRoadRage` (`kind === 'car'` only) and active/cooldown state.
   */
  tryStart(agentIndex: number, playerX: number, playerZ: number): boolean {
    if (this.state !== 'idle' || this.cooldownTimer > 0) return false;
    if (!this.traffic.canTriggerRoadRage(agentIndex)) return false;

    const carPose = this.traffic.pullOverCar(agentIndex, 48);
    if (!carPose) return false;

    this.carAgentIdx = agentIndex;
    this.state = 'exiting';
    this.stateTimer = 0;
    this.escapeRemaining = ESCAPE_HOLD_SECONDS;
    this.driverSpoken = false;
    this.playerSpoken = false;

    // Step out on the side of the sedan facing closer to / safe from the car body
    const rightX = -Math.cos(carPose.yaw);
    const rightZ = Math.sin(carPose.yaw);
    const toPlayerSide = (playerX - carPose.x) * rightX + (playerZ - carPose.z) * rightZ >= 0 ? 1 : -1;
    const spawnX = carPose.x + rightX * 1.25 * toPlayerSide;
    const spawnZ = carPose.z + rightZ * 1.25 * toPlayerSide;
    const gY = this.cb.heightAt(spawnX, spawnZ);
    const faceYaw = Math.atan2(playerX - spawnX, playerZ - spawnZ);

    this.actor.resetPose();
    this.actor.place(spawnX, spawnZ, faceYaw);
    this.actor.group.position.y = gY;
    this.actor.setVisible(true);
    this.driverDistance = Math.hypot(playerX - spawnX, playerZ - spawnZ);

    this.audio.playRoadRageAlert();
    this.cb.onAlertBanner('ROAD RAGE!', 'roadrage.alert', null);
    this.speakDriverThenPlayer();
    return true;
  }

  private speakDriverThenPlayer(): void {
    if (this.driverSpoken) return;
    this.driverSpoken = true;
    const loc = getLocale();
    const driverText = loc === 'en' ? ROADRAGE_DRIVER_LINE_EN : ROADRAGE_DRIVER_LINE;
    const playerText = loc === 'en' ? ROADRAGE_PLAYER_LINE_EN : ROADRAGE_PLAYER_LINE;
    const dlg = this.cb.getDialogueSettings();
    this.cb.onSubtitle('roadrage.speaker.driver', driverText);
    this.speech.speak({
      speaker: 'driver',
      text: driverText,
      locale: loc,
      priority: 3,
      volume: dlg.volume,
      muted: dlg.muted,
      onEnd: () => {
        if (this.state === 'idle' || this.playerSpoken) return;
        this.playerSpoken = true;
        const loc2 = getLocale();
        const pLine = loc2 === 'en' ? ROADRAGE_PLAYER_LINE_EN : playerText;
        const dlg2 = this.cb.getDialogueSettings();
        this.cb.onSubtitle('roadrage.speaker.player', pLine);
        this.speech.speak({
          speaker: 'player',
          text: pLine,
          locale: loc2,
          priority: 3,
          volume: dlg2.volume,
          muted: dlg2.muted,
        });
      },
    });
  }

  update(dt: number, playerX: number, playerZ: number): void {
    if (this.state === 'idle') {
      if (this.cooldownTimer > 0) {
        this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
      }
      return;
    }

    this.stateTimer += dt;

    if (this.state === 'exiting') {
      // Brief 0.55s step-out beat as car pulls over with hazards blinking
      const gY = this.cb.heightAt(this.actor.group.position.x, this.actor.group.position.z);
      this.driverDistance = this.actor.chaseTowards(playerX, playerZ, 1.4, gY, dt);
      if (this.stateTimer >= 0.55) {
        this.state = 'pursuing';
        this.stateTimer = 0;
      }
      return;
    }

    if (this.state === 'pursuing') {
      const gY = this.cb.heightAt(this.actor.group.position.x, this.actor.group.position.z);
      const dist = this.actor.chaseTowards(playerX, playerZ, DRIVER_SPRINT_SPEED, gY, dt);
      this.driverDistance = dist;

      // 1. Caught by the angry car driver!
      if (dist <= CATCH_RADIUS_M && this.stateTimer >= 0.35) {
        this.state = 'confronting';
        this.stateTimer = 0;
        this.actor.resetPose();
        this.cb.onAlertBanner(null);
        this.cb.onOpenConfrontation();
        return;
      }

      // 2. Real world-space uninterrupted 5-second escape countdown
      if (dist >= ESCAPE_DISTANCE_M) {
        this.escapeRemaining = Math.max(0, this.escapeRemaining - dt);
        this.cb.onAlertBanner('ROAD RAGE!', 'roadrage.escaping', this.escapeRemaining);
        if (this.escapeRemaining <= 0) {
          this.finishEncounter(18);
          this.cb.onEscaped();
          return;
        }
      } else {
        // Must stay outside ESCAPE_DISTANCE_M uninterrupted — reset to full 5.0s if driver closes in!
        this.escapeRemaining = ESCAPE_HOLD_SECONDS;
        this.cb.onAlertBanner('ROAD RAGE!', 'roadrage.chaseHint', null);
      }

      // Safety bound if pursuit drags past 45s across city blocks
      if (this.stateTimer > 45) {
        this.finishEncounter(14);
        this.cb.onEscaped();
      }
      return;
    }

    if (this.state === 'confronting') {
      // Modal open: keep NPC facing player cleanly without moving or ticking timers
      const dx = playerX - this.actor.group.position.x;
      const dz = playerZ - this.actor.group.position.z;
      this.actor.group.rotation.y = Math.atan2(dx, dz);
      return;
    }

    if (this.state === 'scuffling') {
      this.actor.animateScuffle(dt);
      if (this.stateTimer >= 1.25) {
        this.finishEncounter(20);
        this.cb.onScuffleComplete();
      }
    }
  }

  /** Player selects `১০০ টাকা দিয়ে মিটমাট করুন`. Returns false if balance < 100. */
  settleWithPayment(spendFn: (amount: number) => boolean): boolean {
    if (this.state !== 'confronting') return false;
    if (!spendFn(ROADRAGE_SETTLE_COST)) return false;
    this.cb.onCloseConfrontation();
    this.finishEncounter(18);
    return true;
  }

  /** Player selects `দেব না` -> non-graphic slapstick street scuffle + stamina/control penalty. */
  refusePayment(): boolean {
    if (this.state !== 'confronting') return false;
    this.cb.onCloseConfrontation();
    this.state = 'scuffling';
    this.stateTimer = 0;
    this.cb.onScuffleStart();
    return true;
  }

  /** Cleanly abort/reset on menu return, mission restart, or vehicle recovery. */
  cancel(cooldown = 0): void {
    if (this.state === 'confronting') {
      this.cb.onCloseConfrontation();
    }
    this.speech.stop();
    this.finishEncounter(cooldown);
  }

  private finishEncounter(cooldown: number): void {
    if (this.carAgentIdx >= 0) {
      this.traffic.releaseCar(this.carAgentIdx, Math.max(12, cooldown));
      this.carAgentIdx = -1;
    }
    this.actor.resetPose();
    this.actor.setVisible(false);
    this.state = 'idle';
    this.stateTimer = 0;
    this.escapeRemaining = ESCAPE_HOLD_SECONDS;
    this.cooldownTimer = cooldown;
    this.cb.onAlertBanner(null);
  }
}
