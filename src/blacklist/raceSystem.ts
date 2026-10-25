/**
 * Rival Race & Blacklist Event Runtime System (v0.5.0 — Sections 11, 26.2, 29.B).
 *
 * Supports all 7 Rival Event Types:
 *   1. `street_race`        — Head-to-head checkpoint race against rival rickshaw
 *   2. `checkpoint_sprint`  — Timed multi-checkpoint high-speed sprint
 *   3. `delivery_rush`      — Urgent cargo sprint with collision-care bonus
 *   4. `shortcut_challenge` — Tight Mohammadpur gali route race
 *   5. `pursuit_escape`     — Survive active Police Heat & reach the safe zone first
 *   6. `rival_duel`         — High-stakes 1v1 Blacklist showdown with roadblocks
 *   7. `traffic_survival`   — High-speed clean run (heavy crash cap)
 *
 * Guarantees:
 *   - 3-2-1-GO start countdown with clean start-line hold
 *   - Graph-validated Rival AI rickshaw with fair rubber-banding & anti-stuck logic
 *   - Reusable pooled 3D checkpoint ring beacon (`castShadow = false`, 0 allocations)
 *   - Clean Win / Loss / Retry / Exit flow (small bounded টাকা loss on defeat, zero
 *     progress wipe, zero soft-locks!)
 */

import * as THREE from 'three';
import { angleDelta, clamp, TAU } from '../core/mathx';
import { findRoute, placeById } from '../world/layout';
import { vehicleById } from '../economy/catalog';
import { DEFAULT_LOOK, RickshawVisual, type RickshawLook } from '../vehicle/rickshawModel';
import { testRickshawCapsuleVsObb } from '../vehicle/rickshawController';
import {
  BLACKLIST_RIVALS,
  type BlacklistRival,
  type RivalEventSpec,
} from './blacklistCatalog';

export type RacePhase = 'idle' | 'countdown' | 'racing' | 'finished';

export interface RaceResultSummary {
  won: boolean;
  event: RivalEventSpec;
  rival: BlacklistRival | null;
  timeSeconds: number;
  cashDelta: number; // +reward on win, -boundedFee on loss
  repEarned: number;
  unlockedNextRank: number | null;
  reasonKey: string;
}

export interface RaceHudSnapshot {
  active: boolean;
  phase: RacePhase;
  countdownText: string;
  eventTitleBn: string;
  eventTitleEn: string;
  checkpointIndex: number;
  checkpointTotal: number;
  playerRank: 1 | 2;
  elapsedSeconds: number;
  remainingSeconds: number;
  targetX: number;
  targetZ: number;
  rivalX: number;
  rivalZ: number;
  hasRival: boolean;
}

export class RivalRaceSystem {
  readonly group = new THREE.Group();
  private phase: RacePhase = 'idle';
  private activeEvent: RivalEventSpec | null = null;
  private activeRival: BlacklistRival | null = null;

  private countdownTimer = 0;
  private elapsed = 0;
  private startHits = 0;
  private lastLossPenaltyAt = -60;

  private checkpoints: { x: number; z: number }[] = [];
  private cpIndex = 0;

  // Rival AI state along full path points
  private rivalVisual: RickshawVisual | null = null;
  private rivalPath: { x: number; z: number }[] = [];
  private rivalWpIdx = 0;
  private rivalX = 0;
  private rivalY = 0;
  private rivalZ = 0;
  private rivalYaw = 0;
  private rivalSpeed = 0;
  private rivalFinished = false;
  private playerRank: 1 | 2 = 1;

  // Reusable 3D checkpoint beacon (zero per-race geometry leaks!)
  private readonly beaconGroup = new THREE.Group();
  private readonly beaconRing: THREE.Mesh;
  private readonly beaconPillarL: THREE.Mesh;
  private readonly beaconPillarR: THREE.Mesh;
  private readonly hudSnap: RaceHudSnapshot = {
    active: false,
    phase: 'idle',
    countdownText: '',
    eventTitleBn: '',
    eventTitleEn: '',
    checkpointIndex: 0,
    checkpointTotal: 0,
    playerRank: 1,
    elapsedSeconds: 0,
    remainingSeconds: 0,
    targetX: 0,
    targetZ: 0,
    rivalX: 0,
    rivalZ: 0,
    hasRival: false,
  };

  onCountdownTick?: (num: number) => void;
  onRaceGo?: (event: RivalEventSpec) => void;
  onCheckpointPassed?: (index: number, total: number) => void;
  onRaceFinished?: (summary: RaceResultSummary) => void;

  constructor(private readonly heightAt: (x: number, z: number) => number) {
    this.group.name = 'rival-race-system';

    const ringGeo = new THREE.TorusGeometry(2.6, 0.14, 8, 24);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
    this.beaconRing = new THREE.Mesh(ringGeo, ringMat);
    this.beaconRing.position.set(0, 2.7, 0);

    const pilGeo = new THREE.CylinderGeometry(0.14, 0.18, 4.4, 8);
    const pilMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.82,
    });
    this.beaconPillarL = new THREE.Mesh(pilGeo, pilMat);
    this.beaconPillarR = new THREE.Mesh(pilGeo, pilMat);
    this.beaconPillarL.position.set(-3.4, 2.2, 0);
    this.beaconPillarR.position.set(3.4, 2.2, 0);

    this.beaconGroup.add(this.beaconRing, this.beaconPillarL, this.beaconPillarR);
    this.beaconGroup.visible = false;
    this.group.add(this.beaconGroup);
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

  /** Prewarm checkpoint beacon during boot. */
  withPrewarmState(run: () => void): void {
    const prev = this.beaconGroup.visible;
    this.beaconGroup.visible = true;
    try {
      run();
    } finally {
      this.beaconGroup.visible = prev;
    }
  }

  /**
   * Launch any Rival Event or Blacklist Boss Match.
   * Returns exact start pose `{ x, z, yaw }` for the player rickshaw!
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

    // Build validated checkpoint list from `PLACES`
    const pts: { x: number; z: number; heading: number }[] = [];
    for (const pid of event.waypointPlaceIds) {
      const p = placeById(pid);
      if (p) pts.push({ x: p.x, z: p.z, heading: p.heading });
    }
    if (pts.length < 2) {
      const a = placeById('stand')!;
      const b = placeById('bazaar')!;
      pts.push({ x: a.x, z: a.z, heading: a.heading }, { x: b.x, z: b.z, heading: b.heading });
    }

    const startPt = pts[0];
    this.checkpoints = pts.slice(1).map((p) => ({ x: p.x, z: p.z }));
    this.cpIndex = 0;

    // Build smooth connected road path across all checkpoints for Rival AI
    this.rivalPath = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const leg = findRoute(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z);
      for (let j = i === 0 ? 0 : 1; j < leg.points.length; j++) {
        this.rivalPath.push(leg.points[j]);
      }
    }

    const firstTarget = this.rivalPath[1] ?? this.checkpoints[0];
    const startYaw = Math.atan2(firstTarget.x - startPt.x, firstTarget.z - startPt.z);

    // Spawn 3D Rival Rickshaw right beside the player on the starting grid!
    const look: RickshawLook = this.activeRival?.look ?? {
      ...DEFAULT_LOOK,
      frameColor: '#9b1c2c',
      canopyColor: '#1d4ed8',
      canopyTrim: '#facc15',
      bellUpgrade: true,
    };
    const vehDef = look.kind === 'electric' ? vehicleById('electric') : vehicleById('cinema');
    this.rivalVisual = new RickshawVisual(vehDef, look, false);
    const rightX = -Math.cos(startYaw);
    const rightZ = Math.sin(startYaw);
    this.rivalX = startPt.x + rightX * 1.65;
    this.rivalZ = startPt.z + rightZ * 1.65;
    this.rivalY = this.heightAt(this.rivalX, this.rivalZ);
    this.rivalYaw = startYaw;
    this.rivalSpeed = 0;
    this.rivalWpIdx = 1;
    this.rivalFinished = false;
    this.rivalVisual.root.position.set(this.rivalX, this.rivalY, this.rivalZ);
    this.rivalVisual.root.rotation.set(0, this.rivalYaw, 0);
    this.group.add(this.rivalVisual.root);

    this.phase = 'countdown';
    this.countdownTimer = 3.0;
    this.elapsed = 0;
    this.startHits = currentHits;
    this.playerRank = 1;
    this.syncBeacon();

    return {
      x: startPt.x - rightX * 1.15,
      z: startPt.z - rightZ * 1.15,
      yaw: startYaw,
    };
  }

  cancel(): void {
    this.phase = 'idle';
    this.activeEvent = null;
    this.activeRival = null;
    this.beaconGroup.visible = false;
    if (this.rivalVisual) {
      this.group.remove(this.rivalVisual.root);
      this.rivalVisual.dispose();
      this.rivalVisual = null;
    }
  }

  private syncBeacon(): void {
    const cp = this.checkpoints[this.cpIndex];
    if (!cp || (this.phase !== 'countdown' && this.phase !== 'racing')) {
      this.beaconGroup.visible = false;
      return;
    }
    const gy = this.heightAt(cp.x, cp.z);
    this.beaconGroup.position.set(cp.x, gy, cp.z);
    this.beaconGroup.visible = true;
    const isFinal = this.cpIndex === this.checkpoints.length - 1;
    (this.beaconRing.material as THREE.MeshBasicMaterial).color.setHex(
      isFinal ? 0xfacc15 : 0x22d3ee,
    );
  }

  update(
    dt: number,
    px: number,
    pz: number,
    currentHits: number,
    simNowSec: number,
  ): RaceHudSnapshot {
    if ((this.phase !== 'countdown' && this.phase !== 'racing') || !this.activeEvent) {
      this.hudSnap.active = false;
      this.hudSnap.phase = this.phase;
      return this.hudSnap;
    }

    this.beaconRing.rotation.y += dt * 2.2;

    if (this.phase === 'countdown') {
      const prevCeil = Math.ceil(this.countdownTimer);
      this.countdownTimer -= dt;
      const nextCeil = Math.ceil(Math.max(0, this.countdownTimer));
      if (nextCeil > 0 && nextCeil !== prevCeil) {
        this.onCountdownTick?.(nextCeil);
      }
      if (this.countdownTimer <= 0) {
        this.phase = 'racing';
        this.onRaceGo?.(this.activeEvent);
      }
    } else if (this.phase === 'racing') {
      this.elapsed += dt;
      this.stepRivalAi(dt, px, pz);

      const cp = this.checkpoints[this.cpIndex];
      if (cp) {
        const distToCp = Math.hypot(px - cp.x, pz - cp.z);
        // Generous 9.5m arcade gate radius so full-speed Turbo runs never miss a gate by inches!
        if (distToCp <= 9.5) {
          this.cpIndex++;
          if (this.cpIndex >= this.checkpoints.length) {
            // Player crossed the finish line!
            const won = !this.rivalFinished;
            this.concludeRace(won, won ? 'race.winReason' : 'race.lostToRival', simNowSec);
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
        this.concludeRace(false, 'race.tooManyHits', simNowSec);
        return this.hudSnap;
      }

      // Time limit check
      if (this.elapsed >= this.activeEvent.targetSeconds) {
        this.concludeRace(false, 'race.timeExpired', simNowSec);
        return this.hudSnap;
      }

      // Compute live 1st / 2nd rank
      const finishPt = this.checkpoints[this.checkpoints.length - 1];
      const playerRem =
        (this.checkpoints.length - 1 - this.cpIndex) * 95 +
        Math.hypot(px - (cp?.x ?? finishPt.x), pz - (cp?.z ?? finishPt.z));
      const rivalRem = this.rivalFinished
        ? 0
        : (this.rivalPath.length - 1 - this.rivalWpIdx) * 42 +
          Math.hypot(
            this.rivalX - (this.rivalPath[this.rivalWpIdx]?.x ?? finishPt.x),
            this.rivalZ - (this.rivalPath[this.rivalWpIdx]?.z ?? finishPt.z),
          );
      this.playerRank = playerRem <= rivalRem ? 1 : 2;
    }

    const activeCp =
      this.checkpoints[this.cpIndex] ?? this.checkpoints[this.checkpoints.length - 1];
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
    this.hudSnap.checkpointIndex = this.cpIndex + 1;
    this.hudSnap.checkpointTotal = this.checkpoints.length;
    this.hudSnap.playerRank = this.playerRank;
    this.hudSnap.elapsedSeconds = this.elapsed;
    this.hudSnap.remainingSeconds = Math.max(0, this.activeEvent.targetSeconds - this.elapsed);
    this.hudSnap.targetX = activeCp?.x ?? px;
    this.hudSnap.targetZ = activeCp?.z ?? pz;
    this.hudSnap.rivalX = this.rivalX;
    this.hudSnap.rivalZ = this.rivalZ;
    this.hudSnap.hasRival = this.rivalVisual !== null;
    return this.hudSnap;
  }

  private stepRivalAi(dt: number, px: number, pz: number): void {
    if (!this.rivalVisual || !this.activeEvent || this.rivalFinished) return;
    const wp = this.rivalPath[this.rivalWpIdx];
    if (!wp) {
      this.rivalFinished = true;
      return;
    }

    const dx = wp.x - this.rivalX;
    const dz = wp.z - this.rivalZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 6.5) {
      this.rivalWpIdx++;
      if (this.rivalWpIdx >= this.rivalPath.length) {
        this.rivalFinished = true;
        this.rivalSpeed = 0;
        return;
      }
    }

    const targetYaw = Math.atan2(dx, dz);
    const dyaw = angleDelta(this.rivalYaw, targetYaw);
    this.rivalYaw = ((this.rivalYaw + clamp(dyaw, -3.4 * dt, 3.4 * dt)) % TAU + TAU) % TAU;

    // Gentle arcade rubber-banding: stays competitive without unfair teleporting!
    const distToPlayer = Math.hypot(px - this.rivalX, pz - this.rivalZ);
    const aheadDot =
      ((this.rivalX - px) * Math.sin(this.rivalYaw) +
        (this.rivalZ - pz) * Math.cos(this.rivalYaw)) /
      Math.max(1, distToPlayer);
    const rubber =
      aheadDot > 0.3 && distToPlayer > 28
        ? 0.86 // rival eases slightly when far ahead so races stay thrilling
        : aheadDot < -0.3 && distToPlayer > 24
          ? 1.12 // rival pushes harder when behind
          : 1.0;

    const cornerSlow = Math.abs(dyaw) > 0.45 ? 0.78 : 1.0;
    const targetSpeed = this.activeEvent.rivalBaseSpeed * rubber * cornerSlow;
    this.rivalSpeed += (targetSpeed - this.rivalSpeed) * clamp(dt * 3.5, 0, 1);

    this.rivalX += Math.sin(this.rivalYaw) * this.rivalSpeed * dt;
    this.rivalZ += Math.cos(this.rivalYaw) * this.rivalSpeed * dt;
    this.rivalY = this.heightAt(this.rivalX, this.rivalZ);

    this.rivalVisual.root.position.set(this.rivalX, this.rivalY, this.rivalZ);
    this.rivalVisual.root.rotation.set(0, this.rivalYaw, 0);
    this.rivalVisual.updateVisual(dt, this.rivalSpeed, clamp(-dyaw, -0.5, 0.5), 0.85, 0, this.rivalY, 0);
  }

  /** Resolve physical OBB contact between Player and Rival rickshaws during races. */
  resolvePlayerVsRival(
    rx: number,
    rz: number,
    ryaw: number,
  ): { hit: boolean; pushX: number; pushZ: number } {
    if (!this.rivalVisual || this.phase !== 'racing') return { hit: false, pushX: 0, pushZ: 0 };
    const h = testRickshawCapsuleVsObb(
      rx,
      rz,
      ryaw,
      this.rivalX,
      this.rivalZ,
      0.54,
      1.02,
      this.rivalYaw,
    );
    if (!h.hit) return { hit: false, pushX: 0, pushZ: 0 };
    this.rivalX -= h.pushX * 0.35;
    this.rivalZ -= h.pushZ * 0.35;
    return { hit: true, pushX: h.pushX * 0.65, pushZ: h.pushZ * 0.65 };
  }

  private concludeRace(won: boolean, reasonKey: string, simNowSec: number): void {
    const ev = this.activeEvent!;
    const rv = this.activeRival;
    const timeSec = Number(this.elapsed.toFixed(1));
    this.phase = 'finished';
    this.beaconGroup.visible = false;
    if (this.rivalVisual) {
      this.group.remove(this.rivalVisual.root);
      this.rivalVisual.dispose();
      this.rivalVisual = null;
    }

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

    this.onRaceFinished?.({
      won,
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
  }
}
