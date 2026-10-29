/**
 * Four-Rickshaw Race & Blacklist Event Runtime System (v0.5.0 — Sections 11, 26, 27).
 *
 * Full 4-participant street racing (`1 Player + 3 Distinct AI Rivals`) over
 * purpose-built Mohammadpur circuits and sprints (`raceRoutes.ts`):
 *   - Validated 2×2 staggered starting grid (`slots[0..2]` = 3 distinct AI
 *     rivals ahead, `slots[3]` = Player) with Dhaka start/finish gantry arch
 *   - Data-driven AI opponents with unmistakable 3D characters, custom rickshaw
 *     liveries, and complementary racing tendencies (`clean_line`,
 *     `aggressive_overtaker`, `shortcut_seeker`)
 *   - Traffic-, roadblock-, and racer-aware overtaking without teleporting
 *   - True checkpoint + lap route-progress standings (`1/4` through `4/4`)
 *   - Single-fire finish & reward latch (`concluded`), safe respawn pose, and
 *     zero geometry/material/audio leaks across unlimited retries/exits!
 */

import * as THREE from 'three';
import { angleDelta, clamp, TAU } from '../core/mathx';
import { distanceToRoadCarriageway, snapToNearestRoad } from '../world/layout';
import { Bucket } from '../world/geo';
import { vehicleById } from '../economy/catalog';
import { RickshawVisual } from '../vehicle/rickshawModel';
import { RivalVisualBatch } from './rivalBatch';
import { testRickshawCapsuleVsObb } from '../vehicle/rickshawController';
import {
  BLACKLIST_RIVALS,
  selectRaceRivalTrio,
  type BlacklistRival,
  type RivalEventSpec,
} from './blacklistCatalog';
import {
  buildAiWaypointsForTendency,
  buildRaceCourse,
  type AiRacingTendency,
  type AiWaypoint,
  type BuiltRaceCourse,
} from './raceRoutes';

export type RacePhase = 'idle' | 'countdown' | 'racing' | 'finished';

export interface RaceObstacle {
  x: number;
  z: number;
  halfWidth: number;
  halfLength: number;
  yaw: number;
}

export interface RaceRoadblockObstacle {
  cx: number;
  cz: number;
  halfX: number;
  halfZ: number;
  yaw: number;
  disabled?: boolean;
}

export interface RaceStandingEntry {
  position: 1 | 2 | 3 | 4;
  id: string;
  isPlayer: boolean;
  nameBn: string;
  nameEn: string;
  accentHex: string;
  tendency: AiRacingTendency | 'player';
  checkpointsCleared: number;
  checkpointTotal: number;
  finished: boolean;
  timeSeconds: number;
}

export interface RaceResultSummary {
  won: boolean;
  playerPosition: 1 | 2 | 3 | 4;
  totalRacers: 2 | 4;
  topSpeedKmh: number;
  laps: number;
  standings: RaceStandingEntry[];
  event: RivalEventSpec;
  rival: BlacklistRival | null;
  timeSeconds: number;
  cashDelta: number; // +reward on win, -boundedFee on loss
  repEarned: number;
  unlockedNextRank: number | null;
  reasonKey: string;
}

export interface RivalMarker {
  id: string;
  nameBn: string;
  nameEn: string;
  accentHex: string;
  x: number;
  z: number;
  yaw: number;
}

export interface RaceHudSnapshot {
  active: boolean;
  phase: RacePhase;
  countdownText: string;
  eventTitleBn: string;
  eventTitleEn: string;
  checkpointIndex: number;
  checkpointTotal: number;
  lapIndex: number;
  lapTotal: number;
  playerRank: 1 | 2 | 3 | 4;
  totalRacers: 2 | 4;
  elapsedSeconds: number;
  remainingSeconds: number;
  targetX: number;
  targetZ: number;
  rivalX: number;
  rivalZ: number;
  hasRival: boolean;
  rivals: RivalMarker[];
}

export interface AiRacerRuntime {
  slotIndex: 0 | 1 | 2;
  id: string;
  rival: BlacklistRival;
  tendency: AiRacingTendency;
  speedScale: number;
  visual: RickshawVisual;
  waypoints: AiWaypoint[];
  wpIdx: number;
  cpIndex: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  laneOffset: number;
  targetLaneOffset: number;
  stuckTimer: number;
  finished: boolean;
  finishTimeSec: number;
}

export class RivalRaceSystem {
  readonly group = new THREE.Group();
  private phase: RacePhase = 'idle';
  private activeEvent: RivalEventSpec | null = null;
  private activeRival: BlacklistRival | null = null;
  private activeCourse: BuiltRaceCourse | null = null;
  private concluded = false;

  private countdownTimer = 0;
  private elapsed = 0;
  private startHits = 0;
  private playerTopSpeedMps = 0;
  private lastLossPenaltyAt = -60;

  /** Publicly readable mandatory gate coordinates across the race (`verify-v0.5.0` compatible). */
  checkpoints: { x: number; z: number; radius: number; yaw: number }[] = [];
  private cpIndex = 0;
  private playerStartPose = { x: 0, z: 0, yaw: 0 };
  private lastClearedPose = { x: 0, z: 0, yaw: 0 };

  // Exactly 3 distinct AI opponents (`1 Player + 3 AI = 4-Rickshaw Race`)
  private aiRacers: AiRacerRuntime[] = [];
  private rivalBatch: RivalVisualBatch | null = null;
  private playerRank: 1 | 2 | 3 | 4 = 4;

  // Pooled 3D checkpoint beacon + Dhaka bamboo-festoon Start/Finish Arch (0 per-race leaks!)
  private readonly beaconGroup = new THREE.Group();
  private readonly beaconRing: THREE.Mesh;
  private readonly beaconPillarL: THREE.Mesh;
  private readonly beaconPillarR: THREE.Mesh;
  private readonly beaconChevron: THREE.Mesh;
  private readonly startArchGroup = new THREE.Group();
  private readonly startArchMesh: THREE.Mesh;

  readonly hudSnap: RaceHudSnapshot = {
    active: false,
    phase: 'idle',
    countdownText: '',
    eventTitleBn: '',
    eventTitleEn: '',
    checkpointIndex: 0,
    checkpointTotal: 0,
    lapIndex: 1,
    lapTotal: 1,
    playerRank: 4,
    totalRacers: 4,
    elapsedSeconds: 0,
    remainingSeconds: 0,
    targetX: 0,
    targetZ: 0,
    rivalX: 0,
    rivalZ: 0,
    hasRival: false,
    rivals: [],
  };

  onCountdownTick?: (num: number) => void;
  onRaceGo?: (event: RivalEventSpec) => void;
  onCheckpointPassed?: (index: number, total: number) => void;
  onLapCompleted?: (lapCompleted: number, totalLaps: number) => void;
  onRaceFinished?: (summary: RaceResultSummary) => void;

  constructor(private readonly heightAt: (x: number, z: number) => number) {
    this.group.name = 'rival-race-system';

    const ringGeo = new THREE.TorusGeometry(2.6, 0.14, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    this.beaconRing = new THREE.Mesh(ringGeo, ringMat);
    this.beaconRing.position.set(0, 2.75, 0);

    const pilGeo = new THREE.CylinderGeometry(0.14, 0.18, 4.4, 8);
    const pilMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.82,
    });
    this.beaconPillarL = new THREE.Mesh(pilGeo, pilMat);
    this.beaconPillarR = new THREE.Mesh(pilGeo, pilMat);
    this.beaconPillarL.position.set(-3.6, 2.2, 0);
    this.beaconPillarR.position.set(3.6, 2.2, 0);

    // Directional racing-line chevron arrow above checkpoint ring
    const chevGeo = new THREE.ConeGeometry(0.55, 1.25, 4);
    const chevMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    this.beaconChevron = new THREE.Mesh(chevGeo, chevMat);
    this.beaconChevron.rotation.x = Math.PI / 2;
    this.beaconChevron.position.set(0, 4.35, 0);

    this.beaconGroup.add(this.beaconRing, this.beaconPillarL, this.beaconPillarR, this.beaconChevron);
    this.beaconGroup.visible = false;
    this.group.add(this.beaconGroup);

    // Pooled Dhaka Street-Race Start/Finish Bamboo & Festoon Arch (unit half-span = 1m along X, scaled to road width!)
    const archMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const bArch = new Bucket('race.startArch', archMat);
    for (const sx of [-0.52, 0.52]) {
      bArch.cylinder({ x: sx, y: 2.4, z: 0 }, 0.035, 4.8, '#d97706');
      bArch.box({ x: sx, y: 0.25, z: 0 }, { x: 0.09, y: 0.5, z: 0.45 }, '#1e293b');
    }
    bArch.box({ x: 0, y: 4.55, z: 0 }, { x: 1.08, y: 0.58, z: 0.16 }, '#0f172a');
    bArch.box({ x: 0, y: 4.55, z: 0.09 }, { x: 1.02, y: 0.42, z: 0.04 }, '#dc2626');
    bArch.box({ x: 0, y: 4.55, z: -0.09 }, { x: 1.02, y: 0.42, z: 0.04 }, '#dc2626');
    for (let f = -4; f <= 4; f++) {
      bArch.cone(
        { x: f * 0.11, y: 4.12, z: 0 },
        0.045,
        0.32,
        f % 2 === 0 ? '#facc15' : '#2ec4b6',
        { x: Math.PI },
      );
    }
    this.startArchMesh = bArch.build({ cast: false, receive: false }, true)!;
    this.startArchGroup.add(this.startArchMesh);
    this.startArchGroup.visible = false;
    this.group.add(this.startArchGroup);
  }

  get isActive(): boolean {
    return this.phase === 'countdown' || this.phase === 'racing';
  }

  get isStartLocked(): boolean {
    return this.phase === 'countdown';
  }

  get currentEvent(): RivalEventSpec | null {
    return this.activeEvent;
  }

  get currentRival(): BlacklistRival | null {
    return this.activeRival;
  }

  get currentCourse(): BuiltRaceCourse | null {
    return this.activeCourse;
  }

  /** Total racer count when active (`1 Player + 3 AI Rivals = 4`), or `0` when idle. */
  get participantCount(): number {
    return this.isActive ? 1 + this.aiRacers.length : 0;
  }

  getAiRacersSnapshot(): {
    id: string;
    rivalRank: number;
    nameBn: string;
    nameEn: string;
    tendency: AiRacingTendency;
    frameColor: string;
    canopyColor: string;
    hairStyle: string;
    outfitStyle: string;
    x: number;
    z: number;
    yaw: number;
    speed: number;
    cpIndex: number;
    wpIdx: number;
    hasVisibleDriver: boolean;
  }[] {
    return this.aiRacers.map((r) => ({
      id: r.id,
      rivalRank: r.rival.rank,
      nameBn: r.rival.nameBn,
      nameEn: r.rival.nameEn,
      tendency: r.tendency,
      frameColor: r.rival.look.frameColor,
      canopyColor: r.rival.look.canopyColor,
      hairStyle: r.rival.character.hairStyle,
      outfitStyle: r.rival.character.outfitStyle,
      x: Number(r.x.toFixed(2)),
      z: Number(r.z.toFixed(2)),
      yaw: Number(r.yaw.toFixed(3)),
      speed: Number(r.speed.toFixed(2)),
      cpIndex: r.cpIndex,
      wpIdx: r.wpIdx,
      hasVisibleDriver: Boolean(
        r.visual.rig.puller.visible &&
          r.visual.rig.puller.getObjectByName('pullerHead') &&
          r.visual.rig.puller.getObjectByName('leftArm') &&
          r.visual.rig.puller.getObjectByName('rightArm'),
      ),
    }));
  }

  /** Record live player speed during racing so Winner Photo shows accurate peak km/h. */
  recordPlayerSpeed(speedMps: number): void {
    if (this.phase === 'racing' && Number.isFinite(speedMps)) {
      const abs = Math.abs(speedMps);
      if (abs > this.playerTopSpeedMps) this.playerTopSpeedMps = abs;
    }
  }

  /** Safe road-validated respawn pose on the active race course. */
  getSafeRespawnPose(): { x: number; z: number; yaw: number } | null {
    if (!this.isActive) return null;
    return { ...this.lastClearedPose };
  }

  /** Prewarm checkpoint beacon & start arch during boot. */
  withPrewarmState(run: () => void): void {
    const prevB = this.beaconGroup.visible;
    const prevA = this.startArchGroup.visible;
    this.beaconGroup.visible = true;
    this.startArchGroup.visible = true;
    try {
      run();
    } finally {
      this.beaconGroup.visible = prevB;
      this.startArchGroup.visible = prevA;
    }
  }

  /**
   * Launch any Rival Event or Blacklist Boss Match as a full 4-rickshaw race!
   * Returns exact grid slot `{ x, z, yaw }` for the player rickshaw (`slot 3`).
   */
  startEvent(
    event: RivalEventSpec,
    rival: BlacklistRival | null,
    currentHits: number,
  ): { x: number; z: number; yaw: number } {
    this.cancel();

    this.activeEvent = event;
    this.activeRival =
      rival ??
      (event.blacklistRank
        ? BLACKLIST_RIVALS.find((r) => r.rank === event.blacklistRank) ?? null
        : null);
    this.concluded = false;
    this.playerTopSpeedMps = 0;

    const course = buildRaceCourse(event);
    this.activeCourse = course;
    this.checkpoints = course.allCheckpoints.map((g) => ({
      x: g.x,
      z: g.z,
      radius: g.radius,
      yaw: g.yaw,
    }));
    this.cpIndex = 0;

    // Position pooled Start Arch cleanly across the starting carriageway
    const archY = this.heightAt(course.startBanner.x, course.startBanner.z);
    this.startArchGroup.position.set(course.startBanner.x, archY, course.startBanner.z);
    this.startArchGroup.rotation.set(0, course.startBanner.yaw, 0);
    this.startArchGroup.scale.set(Math.max(7.2, course.startBanner.width + 1.2), 1, 1);
    this.startArchGroup.visible = true;

    // Spawn 3 distinct AI opponents in staggered front slots 0, 1, 2!
    const trio = selectRaceRivalTrio(event, this.activeRival);
    // Blacklist ladder matches are head-to-head; open street events retain
    // the full four-rickshaw field.
    const entrants = event.blacklistRank ? trio.slice(0, 1) : trio;
    this.aiRacers = entrants.map((slotCfg, idx) => {
      const slot = course.gridSlots[idx as 0 | 1 | 2];
      const vehDef =
        slotCfg.rival.look.kind === 'electric' ? vehicleById('electric') : vehicleById('cinema');
      const visual = new RickshawVisual(vehDef, slotCfg.rival.look, false);
      const gy = this.heightAt(slot.x, slot.z);
      visual.root.position.set(slot.x, gy, slot.z);
      visual.root.rotation.set(0, slot.yaw, 0);
      visual.setCharacterPose('riding', 0);
      visual.updateVisual(0.016, 0, 0, 0, 0, gy, 0);
      this.group.add(visual.root);

      const waypoints = buildAiWaypointsForTendency(course, slot, slotCfg.tendency);
      const baseBias =
        slotCfg.tendency === 'clean_line'
          ? -0.55
          : slotCfg.tendency === 'aggressive_overtaker'
            ? 0.65
            : 0.0;

      return {
        slotIndex: idx as 0 | 1 | 2,
        id: slotCfg.rival.id,
        rival: slotCfg.rival,
        tendency: slotCfg.tendency,
        speedScale: slotCfg.speedScale,
        visual,
        waypoints,
        wpIdx: 0,
        cpIndex: 0,
        x: slot.x,
        y: gy,
        z: slot.z,
        yaw: slot.yaw,
        speed: 0,
        laneOffset: baseBias,
        targetLaneOffset: baseBias,
        stuckTimer: 0,
        finished: false,
        finishTimeSec: Infinity,
      } satisfies AiRacerRuntime;
    });

    this.rivalBatch = new RivalVisualBatch(this.group, this.aiRacers.map((r) => r.visual.root));

    const playerSlot = course.gridSlots[event.blacklistRank ? 1 : 3];
    this.playerStartPose = { x: playerSlot.x, z: playerSlot.z, yaw: playerSlot.yaw };
    this.lastClearedPose = { ...this.playerStartPose };

    this.phase = 'countdown';
    this.countdownTimer = 3.0;
    this.elapsed = 0;
    this.startHits = currentHits;
    this.playerRank = event.blacklistRank ? 2 : 4;
    this.syncBeacon();

    return { ...this.playerStartPose };
  }

  cancel(): void {
    this.phase = 'idle';
    this.activeEvent = null;
    this.activeRival = null;
    this.activeCourse = null;
    this.concluded = false;
    this.beaconGroup.visible = false;
    this.startArchGroup.visible = false;
    this.rivalBatch?.dispose();
    this.rivalBatch = null;
    for (let i = 0; i < this.aiRacers.length; i++) {
      const r = this.aiRacers[i];
      this.group.remove(r.visual.root);
      r.visual.dispose();
    }
    this.aiRacers = [];
    this.hudSnap.active = false;
    this.hudSnap.phase = 'idle';
    this.hudSnap.rivals = [];
  }

  private syncBeacon(): void {
    const cp = this.checkpoints[this.cpIndex];
    if (!cp || (this.phase !== 'countdown' && this.phase !== 'racing')) {
      this.beaconGroup.visible = false;
      return;
    }
    const gy = this.heightAt(cp.x, cp.z);
    this.beaconGroup.position.set(cp.x, gy, cp.z);
    this.beaconGroup.rotation.set(0, cp.yaw, 0);
    this.beaconGroup.visible = true;
    const isFinal = this.cpIndex === this.checkpoints.length - 1;
    (this.beaconRing.material as THREE.MeshBasicMaterial).color.setHex(
      isFinal ? 0xfacc15 : 0x22d3ee,
    );
  }

  get lapCount(): number {
    return this.activeCourse?.laps ?? 1;
  }

  getStandings(px: number, pz: number): RaceStandingEntry[] {
    return this.computeStandings(px, pz, false);
  }

  update(
    dt: number,
    px: number,
    pz: number,
    currentHits: number,
    simNowSec: number,
    trafficObstacles: readonly RaceObstacle[] = [],
    roadblockObstacles: readonly RaceRoadblockObstacle[] = [],
  ): RaceHudSnapshot {
    if ((this.phase !== 'countdown' && this.phase !== 'racing') || !this.activeEvent || !this.activeCourse) {
      this.hudSnap.active = false;
      this.hudSnap.phase = this.phase;
      return this.hudSnap;
    }

    if (dt > 0) {
      this.beaconRing.rotation.y += dt * 2.2;
      this.beaconChevron.position.y = 4.35 + Math.sin(this.elapsed * 4.5) * 0.18;
    }

    if (this.phase === 'countdown') {
      if (dt > 0) {
        const prevCeil = Math.ceil(this.countdownTimer);
        this.countdownTimer -= dt;
        const nextCeil = Math.ceil(Math.max(0, this.countdownTimer));
        if (nextCeil > 0 && nextCeil !== prevCeil) {
          this.onCountdownTick?.(nextCeil);
        }
        for (let i = 0; i < this.aiRacers.length; i++) {
          const r = this.aiRacers[i];
          r.visual.updateVisual(dt, 0, Math.sin(this.countdownTimer * 3 + i) * 0.08, 0.25, 0, r.y, 0);
        }
        if (this.countdownTimer <= 0) {
          this.phase = 'racing';
          this.onRaceGo?.(this.activeEvent);
        }
      }
    } else if (this.phase === 'racing' && dt > 0) {
      this.elapsed += dt;
      this.stepAllAiRacers(dt, px, pz, trafficObstacles, roadblockObstacles);

      const cp = this.checkpoints[this.cpIndex];
      if (cp) {
        const distToCp = Math.hypot(px - cp.x, pz - cp.z);
        if (distToCp <= cp.radius) {
          const snap = snapToNearestRoad(cp.x, cp.z);
          this.lastClearedPose = { x: snap.x, z: snap.z, yaw: cp.yaw };
          this.cpIndex++;

          const gatesPerLap = Math.max(1, this.activeCourse.lapGates.length);
          if (
            this.activeCourse.laps > 1 &&
            this.cpIndex < this.checkpoints.length &&
            this.cpIndex % gatesPerLap === 0
          ) {
            this.onLapCompleted?.(Math.floor(this.cpIndex / gatesPerLap), this.activeCourse.laps);
          }

          if (this.cpIndex >= this.checkpoints.length) {
            // Player crossed the finish line! Compute exact final standing against all 3 rivals!
            const anyAiAlreadyFinished = this.aiRacers.some((r) => r.finished);
            const won = !anyAiAlreadyFinished;
            this.concludeRace(won, won ? 'race.winReason' : 'race.lostToRival', simNowSec, px, pz, true);
            return this.hudSnap;
          }
          this.onCheckpointPassed?.(this.cpIndex, this.checkpoints.length);
          this.syncBeacon();
        }
      }

      // Traffic Survival collision limit check (8 hits max so minor scrapes don't instafail!)
      if (
        this.activeEvent.kind === 'traffic_survival' &&
        currentHits - this.startHits >= 8
      ) {
        this.concludeRace(false, 'race.tooManyHits', simNowSec, px, pz, false);
        return this.hudSnap;
      }

      // Time limit check
      if (this.elapsed >= this.activeEvent.targetSeconds) {
        this.concludeRace(false, 'race.timeExpired', simNowSec, px, pz, false);
        return this.hudSnap;
      }
    }

    // Live 4-racer progress standings (`1/4` through `4/4`)
    const standings = this.computeStandings(px, pz, false);
    const pEntry = standings.find((s) => s.isPlayer);
    this.playerRank = pEntry ? pEntry.position : 4;

    const gatesPerLap = Math.max(1, this.activeCourse.lapGates.length);
    const curLap = Math.min(this.activeCourse.laps, Math.floor(this.cpIndex / gatesPerLap) + 1);
    const activeCp =
      this.checkpoints[this.cpIndex] ?? this.checkpoints[this.checkpoints.length - 1];
    const leadAi = this.aiRacers[0];

    this.hudSnap.active = true;
    this.hudSnap.phase = this.phase;
    this.hudSnap.countdownText =
      this.phase === 'countdown'
        ? String(Math.max(1, Math.ceil(this.countdownTimer)))
        : this.elapsed < 0.9
          ? 'GO!'
          : '';
    this.hudSnap.eventTitleBn = this.activeEvent.titleBn;
    this.hudSnap.eventTitleEn = this.activeEvent.titleEn;
    this.hudSnap.checkpointIndex = Math.min(this.checkpoints.length, this.cpIndex + 1);
    this.hudSnap.checkpointTotal = this.checkpoints.length;
    this.hudSnap.lapIndex = curLap;
    this.hudSnap.lapTotal = this.activeCourse.laps;
    this.hudSnap.playerRank = this.playerRank;
    this.hudSnap.totalRacers = this.aiRacers.length === 1 ? 2 : 4;
    this.hudSnap.elapsedSeconds = this.elapsed;
    this.hudSnap.remainingSeconds = Math.max(0, this.activeEvent.targetSeconds - this.elapsed);
    this.hudSnap.targetX = activeCp?.x ?? px;
    this.hudSnap.targetZ = activeCp?.z ?? pz;
    this.hudSnap.rivalX = leadAi?.x ?? px;
    this.hudSnap.rivalZ = leadAi?.z ?? pz;
    this.hudSnap.hasRival = this.aiRacers.length > 0;
    this.hudSnap.rivals = this.aiRacers.map((r) => ({
      id: r.id,
      nameBn: r.rival.nameBn,
      nameEn: r.rival.nameEn,
      accentHex: r.rival.accentHex,
      x: r.x,
      z: r.z,
      yaw: r.yaw,
    }));
    return this.hudSnap;
  }

  private computeProgressScore(cpIdx: number, x: number, z: number, finished: boolean, finishTime: number): number {
    if (finished) {
      return 1_000_000 - finishTime * 10;
    }
    const target = this.checkpoints[Math.min(this.checkpoints.length - 1, cpIdx)];
    const dist = target ? Math.hypot(x - target.x, z - target.z) : 0;
    return cpIdx * 2000 - Math.min(1950, dist);
  }

  computeStandings(px: number, pz: number, playerFinished: boolean): RaceStandingEntry[] {
    const totalCp = this.checkpoints.length;
    const raw: {
      score: number;
      id: string;
      isPlayer: boolean;
      nameBn: string;
      nameEn: string;
      accentHex: string;
      tendency: AiRacingTendency | 'player';
      cpCleared: number;
      finished: boolean;
      timeSec: number;
    }[] = [
      {
        score: this.computeProgressScore(
          playerFinished ? totalCp : this.cpIndex,
          px,
          pz,
          playerFinished,
          this.elapsed,
        ),
        id: 'player',
        isPlayer: true,
        nameBn: 'আপনি (বাংলার টেসলা)',
        nameEn: 'You (Banglar Tesla)',
        accentHex: '#22c55e',
        tendency: 'player',
        cpCleared: playerFinished ? totalCp : this.cpIndex,
        finished: playerFinished,
        timeSec: Number(this.elapsed.toFixed(1)),
      },
    ];

    for (let i = 0; i < this.aiRacers.length; i++) {
      const r = this.aiRacers[i];
      raw.push({
        score: this.computeProgressScore(r.cpIndex, r.x, r.z, r.finished, r.finishTimeSec),
        id: r.id,
        isPlayer: false,
        nameBn: r.rival.nameBn,
        nameEn: r.rival.nameEn,
        accentHex: r.rival.accentHex,
        tendency: r.tendency,
        cpCleared: r.finished ? totalCp : r.cpIndex,
        finished: r.finished,
        timeSec: Number((r.finished ? r.finishTimeSec : this.elapsed).toFixed(1)),
      });
    }

    raw.sort((a, b) => b.score - a.score);
    return raw.map((entry, idx) => ({
      position: (idx + 1) as 1 | 2 | 3 | 4,
      id: entry.id,
      isPlayer: entry.isPlayer,
      nameBn: entry.nameBn,
      nameEn: entry.nameEn,
      accentHex: entry.accentHex,
      tendency: entry.tendency,
      checkpointsCleared: entry.cpCleared,
      checkpointTotal: totalCp,
      finished: entry.finished,
      timeSeconds: entry.timeSec,
    }));
  }

  private stepAllAiRacers(
    dt: number,
    px: number,
    pz: number,
    trafficObstacles: readonly RaceObstacle[],
    roadblockObstacles: readonly RaceRoadblockObstacle[],
  ): void {
    if (!this.activeEvent) return;

    for (let i = 0; i < this.aiRacers.length; i++) {
      this.stepSingleAiRacer(this.aiRacers[i], dt, px, pz, trafficObstacles, roadblockObstacles);
    }

    // Gentle AI-vs-AI physical hull separation so rival rickshaws overtake side-by-side without overlapping!
    for (let i = 0; i < this.aiRacers.length; i++) {
      for (let j = i + 1; j < this.aiRacers.length; j++) {
        const a = this.aiRacers[i];
        const b = this.aiRacers[j];
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const d = Math.hypot(dx, dz);
        const minSep = 1.38;
        if (d > 0.001 && d < minSep) {
          const push = (minSep - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          a.x += nx * push;
          a.z += nz * push;
          b.x -= nx * push;
          b.z -= nz * push;
        }
      }
    }

    for (let i = 0; i < this.aiRacers.length; i++) {
      const r = this.aiRacers[i];
      r.y = this.heightAt(r.x, r.z);
      r.visual.root.position.set(r.x, r.y, r.z);
      r.visual.root.rotation.set(0, r.yaw, 0);
    }
  }

  private stepSingleAiRacer(
    r: AiRacerRuntime,
    dt: number,
    px: number,
    pz: number,
    trafficObstacles: readonly RaceObstacle[],
    roadblockObstacles: readonly RaceRoadblockObstacle[],
  ): void {
    if (!this.activeEvent || r.finished) return;
    let wp = r.waypoints[r.wpIdx];
    if (!wp) {
      r.finished = true;
      r.cpIndex = this.checkpoints.length;
      r.finishTimeSec = this.elapsed;
      r.speed = 0;
      return;
    }

    // Check mandatory gate progression for this AI racer
    const curGate = this.checkpoints[r.cpIndex];
    if (curGate && Math.hypot(r.x - curGate.x, r.z - curGate.z) <= curGate.radius + 1.5) {
      r.cpIndex++;
    }

    const waypointDist = Math.hypot(wp.x - r.x, wp.z - r.z);
    // Wait until the junction centre before selecting the next leg. A 6.4m
    // cut let racers aim across adjacent buildings and stick at narrow turns.
    if (waypointDist < (wp.isLaunch ? 1.5 : 2.2)) {
      if (r.wpIdx + 1 < r.waypoints.length) {
        r.wpIdx++;
        wp = r.waypoints[r.wpIdx];
      } else if (r.cpIndex >= this.checkpoints.length) {
        r.finished = true;
        r.finishTimeSec = this.elapsed;
        r.speed = 0;
        return;
      }
    }
    const baseDx = wp.x - r.x;
    const baseDz = wp.z - r.z;
    const dist = Math.hypot(baseDx, baseDz);

    const fwdX = Math.sin(r.yaw);
    const fwdZ = Math.cos(r.yaw);
    const leftX = fwdZ;
    const leftZ = -fwdX;

    // Detect slower traffic, roadblocks, or player/peers directly ahead and pick a clear overtaking line!
    let blockedAhead = false;
    let blockLat = 0;
    const checkAhead = (ox: number, oz: number, radiusPad: number): void => {
      const rx = ox - r.x;
      const rz = oz - r.z;
      const along = rx * fwdX + rz * fwdZ;
      if (along <= 0.6 || along > 14.5) return;
      const lat = rx * leftX + rz * leftZ;
      if (Math.abs(lat) < radiusPad) {
        blockedAhead = true;
        blockLat = lat;
      }
    };

    for (let i = 0; i < trafficObstacles.length; i++) {
      const ob = trafficObstacles[i];
      checkAhead(ob.x, ob.z, ob.halfWidth + 0.85);
    }
    for (let i = 0; i < roadblockObstacles.length; i++) {
      const rb = roadblockObstacles[i];
      if (rb.disabled) continue;
      checkAhead(rb.cx, rb.cz, rb.halfX + 0.95);
    }
    checkAhead(px, pz, 1.15);

    if (blockedAhead) {
      r.targetLaneOffset = blockLat >= 0 ? -1.45 : 1.45;
    } else if (r.tendency === 'aggressive_overtaker') {
      r.targetLaneOffset = Math.sin(this.elapsed * 0.9 + r.slotIndex * 2.1) * 0.95;
    } else if (r.tendency === 'clean_line') {
      r.targetLaneOffset = -0.5;
    } else {
      r.targetLaneOffset = 0.15;
    }

    r.laneOffset += (r.targetLaneOffset - r.laneOffset) * clamp(dt * 3.2, 0, 1);

    // Aim toward waypoint + lateral overtaking offset (clamped inside road carriageway!)
    const segHeadingX = dist > 0.01 ? baseDx / dist : fwdX;
    const segHeadingZ = dist > 0.01 ? baseDz / dist : fwdZ;
    let aimX = wp.x + segHeadingZ * r.laneOffset;
    let aimZ = wp.z - segHeadingX * r.laneOffset;
    if (distanceToRoadCarriageway(aimX, aimZ) > -0.35) {
      aimX = wp.x;
      aimZ = wp.z;
    }

    const targetYaw = Math.atan2(aimX - r.x, aimZ - r.z);
    const dyaw = angleDelta(r.yaw, targetYaw);
    const maxTurnRate = r.tendency === 'shortcut_seeker' ? 4.1 : 3.6;
    r.yaw = (((r.yaw + clamp(dyaw, -maxTurnRate * dt, maxTurnRate * dt)) % TAU) + TAU) % TAU;

    // Competitive, non-cheating pace modulation (zero teleportation!)
    const distToPlayer = Math.hypot(px - r.x, pz - r.z);
    const aheadDot =
      ((r.x - px) * Math.sin(r.yaw) + (r.z - pz) * Math.cos(r.yaw)) / Math.max(1, distToPlayer);
    const paceMod =
      aheadDot > 0.3 && distToPlayer > 34
        ? 0.90
        : aheadDot < -0.3 && distToPlayer > 28
          ? 1.08
          : 1.0;

    const cornerSlow = Math.abs(dyaw) > 0.48 ? 0.78 : 1.0;
    const turboBurst =
      r.tendency === 'aggressive_overtaker' && wp.isTurboStraight && Math.abs(dyaw) < 0.22
        ? 1.13
        : 1.0;
    const obstacleSlow = blockedAhead ? 0.84 : 1.0;

    const desiredSpeed =
      this.activeEvent.rivalBaseSpeed * r.speedScale * paceMod * cornerSlow * turboBurst * obstacleSlow;
    r.speed += (desiredSpeed - r.speed) * clamp(dt * 3.6, 0, 1);

    // Anti-pinch recovery without teleporting: smoothly nudge around if slowed below 0.9 m/s
    if (r.speed < 0.9) {
      r.stuckTimer += dt;
      if (r.stuckTimer > 1.4) {
        r.laneOffset = -Math.sign(r.laneOffset || 1) * 1.3;
        r.speed = Math.max(r.speed, 2.4);
      }
    } else {
      r.stuckTimer = 0;
    }

    const nextX = r.x + Math.sin(r.yaw) * r.speed * dt;
    const nextZ = r.z + Math.cos(r.yaw) * r.speed * dt;
    if (distanceToRoadCarriageway(nextX, nextZ) <= 0.45) {
      r.x = nextX;
      r.z = nextZ;
    } else {
      const snapped = snapToNearestRoad(nextX, nextZ);
      r.x += (snapped.x - r.x) * clamp(dt * 5, 0, 1);
      r.z += (snapped.z - r.z) * clamp(dt * 5, 0, 1);
    }

    r.visual.updateVisual(
      dt,
      r.speed,
      clamp(-dyaw, -0.55, 0.55),
      0.85,
      dyaw * r.speed * 0.4,
      r.y,
      0,
    );
  }

  /** Resolve physical OBB contact between Player and ALL 3 AI Rival rickshaws during races. */
  resolvePlayerVsRival(
    rx: number,
    rz: number,
    ryaw: number,
  ): { hit: boolean; pushX: number; pushZ: number } {
    if (this.phase !== 'racing' || this.aiRacers.length === 0) {
      return { hit: false, pushX: 0, pushZ: 0 };
    }
    let anyHit = false;
    let totalPushX = 0;
    let totalPushZ = 0;

    for (let i = 0; i < this.aiRacers.length; i++) {
      const r = this.aiRacers[i];
      if (r.finished) continue;
      const h = testRickshawCapsuleVsObb(
        rx + totalPushX,
        rz + totalPushZ,
        ryaw,
        r.x,
        r.z,
        0.54,
        1.02,
        r.yaw,
      );
      if (h.hit) {
        anyHit = true;
        r.x -= h.pushX * 0.38;
        r.z -= h.pushZ * 0.38;
        r.speed *= 0.88;
        totalPushX += h.pushX * 0.62;
        totalPushZ += h.pushZ * 0.62;
      }
    }
    return { hit: anyHit, pushX: totalPushX, pushZ: totalPushZ };
  }

  private concludeRace(
    won: boolean,
    reasonKey: string,
    simNowSec: number,
    px: number,
    pz: number,
    playerCrossedFinish: boolean,
  ): void {
    // Hard single-fire latch: rewards & finish callbacks can NEVER fire twice!
    if (this.concluded || !this.activeEvent) return;
    this.concluded = true;

    const ev = this.activeEvent;
    const rv = this.activeRival;
    const laps = this.activeCourse?.laps ?? 1;
    const timeSec = Number(this.elapsed.toFixed(1));
    const topSpeedKmh = Math.max(18, Math.round(this.playerTopSpeedMps * 3.6));
    const standings = this.computeStandings(px, pz, playerCrossedFinish);
    if (won) {
      // Guarantee winner sits #1 in final standings snapshot
      const pIdx = standings.findIndex((s) => s.isPlayer);
      if (pIdx > 0) {
        const [p] = standings.splice(pIdx, 1);
        standings.unshift(p);
        for (let i = 0; i < standings.length; i++) {
          standings[i].position = (i + 1) as 1 | 2 | 3 | 4;
        }
      }
    } else if (standings[0]?.isPlayer) {
      // On timeout/collision-cap defeat, ensure player is not reported as 1st-place winner
      const swap = standings[1];
      if (swap) {
        standings[1] = standings[0];
        standings[0] = swap;
        standings[0].position = 1;
        standings[1].position = 2;
      }
    }
    const playerPos = standings.find((s) => s.isPlayer)?.position ?? (won ? 1 : (this.aiRacers.length === 1 ? 2 : 4));
    const totalRacers = this.aiRacers.length === 1 ? 2 : 4;

    this.phase = 'finished';
    this.beaconGroup.visible = false;
    this.startArchGroup.visible = false;
    this.rivalBatch?.dispose();
    this.rivalBatch = null;
    for (let i = 0; i < this.aiRacers.length; i++) {
      const r = this.aiRacers[i];
      this.group.remove(r.visual.root);
      r.visual.dispose();
    }
    this.aiRacers = [];

    // Small bounded loss fee with rapid-retry cap (at most 1 loss fee per 18s!)
    let cashDelta = 0;
    let repEarned = 0;
    let unlockedNext: number | null = null;
    if (won) {
      cashDelta = ev.cashReward;
      repEarned = ev.repReward;
      if (ev.blacklistRank && ev.blacklistRank > 1) {
        unlockedNext = ev.blacklistRank - 1;
      } else if (ev.blacklistRank === 1) {
        unlockedNext = 0;
      }
    } else if (simNowSec - this.lastLossPenaltyAt >= 18) {
      this.lastLossPenaltyAt = simNowSec;
      cashDelta = -ev.lossFee;
    }

    this.hudSnap.active = false;
    this.hudSnap.phase = 'finished';
    this.hudSnap.rivals = [];

    this.onRaceFinished?.({
      won,
      playerPosition: playerPos,
      totalRacers,
      topSpeedKmh,
      laps,
      standings,
      event: ev,
      rival: rv,
      timeSeconds: timeSec,
      cashDelta,
      repEarned,
      unlockedNextRank: unlockedNext,
      reasonKey,
    });
  }

  dispose(): void {
    this.cancel();
    this.beaconRing.geometry.dispose();
    (this.beaconRing.material as THREE.Material).dispose();
    this.beaconPillarL.geometry.dispose();
    (this.beaconPillarL.material as THREE.Material).dispose();
    this.beaconChevron.geometry.dispose();
    (this.beaconChevron.material as THREE.Material).dispose();
    this.startArchMesh.geometry.dispose();
    (this.startArchMesh.material as THREE.Material).dispose();
  }
}
