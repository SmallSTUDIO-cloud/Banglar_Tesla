/**
 * Serious, High-Pressure Arcade Police Pursuit System (v0.5.0 — Sections 13, 26.3, 29.A).
 *
 * Architecture & Gameplay Guarantees:
 *   - Bounded 5-unit pooled Dhaka Police Patrol fleet (`MAX_UNITS = 5` reusable
 *     meshes, zero dynamic lights, zero per-frame allocations, zero leaks).
 *   - Explicit bounded Pursuit State Machine:
 *       `idle` -> `detecting` -> `pursuing` <-> `losingSight` -> `cooldown` -> `idle`
 *     plus per-unit AI states:
 *       `searching` | `detecting` | `pursuing` | `intercepting` | `recovering`
 *   - Heat Levels 1 -> 5:
 *       Heat 1: 1 patrol unit, light pursuit, 0 roadblocks
 *       Heat 2: 2 patrol units, 1 roadblock
 *       Heat 3: 3 coordinated units (flank/intercept) + 2 roadblocks
 *       Heat 4: 4 aggressive units + 3 roadblocks + radio alerts
 *       Heat 5: 5 maximum pressure units + 4 roadblocks + junction pincers
 *   - Narrow Gali Tactical Advantage:
 *       Wide police pickups slow down by 32% in narrow `gali` lanes and lose sight
 *       at 36m (vs 58m on wide avenues), making Dhaka rickshaw agility, market
 *       cuts, and `টান`/`টার্বো` bursts genuinely decisive escape tools!
 */

import * as THREE from 'three';
import { angleDelta, clamp, clamp01, TAU } from '../core/mathx';
import { snapToNearestRoad } from '../world/layout';
import { getLaneGraph, sampleLane, type LaneEdge, type LaneGraph, type LanePoint } from './routes';
import { Bucket } from '../world/geo';
import { testRickshawCapsuleVsObb } from '../vehicle/rickshawController';
import type { RoadblockSystem } from './roadblocks';

export type PursuitPhase = 'idle' | 'detecting' | 'pursuing' | 'losingSight' | 'cooldown';
export type PoliceUnitAiState = 'searching' | 'detecting' | 'pursuing' | 'intercepting' | 'recovering';

export interface PoliceUnitSnapshot {
  x: number;
  z: number;
  yaw: number;
  state: PoliceUnitAiState;
}

interface PoliceUnit {
  active: boolean;
  aiState: PoliceUnitAiState;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  lane: LaneEdge;
  s: number;
  stuckTimer: number;
  recoverTimer: number;
  group: THREE.Group;
  beaconRed: THREE.Mesh;
  beaconBlue: THREE.Mesh;
  readonly halfWidth: number;
  readonly halfLength: number;
}

export interface PoliceCallbacks {
  heightAt: (x: number, z: number) => number;
  onDispatchRadio: () => void;
  onPursuitEscaped: (heat: number, repReward: number) => void;
  onPlayerBusted: (heat: number, finePaid: number) => void;
  onHeatEscalated: (newHeat: number) => void;
}

const MAX_UNITS = 5;

export class PolicePursuitSystem {
  readonly group = new THREE.Group();
  private readonly graph: LaneGraph;
  private readonly units: PoliceUnit[] = [];
  private readonly snapshotsScratch: PoliceUnitSnapshot[] = [];
  private readonly obbScratch: { cx: number; cz: number; halfX: number; halfZ: number; yaw: number }[] = [];
  private readonly tmpPt: LanePoint = { x: 0, z: 0, yaw: 0 };

  private bodyGeo!: THREE.BufferGeometry;
  private beaconGeo!: THREE.BufferGeometry;
  private bodyMat!: THREE.MeshLambertMaterial;
  private redMat!: THREE.MeshBasicMaterial;
  private blueMat!: THREE.MeshBasicMaterial;

  private phase: PursuitPhase = 'idle';
  private heatFloat = 0; // 0..5 continuous heat; integer level = clamp(ceil(heatFloat), 1, 5) when active
  private evadeProgress = 0; // 0..1 during losingSight / cooldown
  private bustedProgress = 0; // 0..1 when boxed-in near stationary
  private pursuitDuration = 0;
  private recklessAccumulator = 0;
  private postEscapeImmunity = 0;
  private radioCooldown = 0;
  private clock = 0;
  private nearestUnitDist = 999;

  constructor(
    private readonly roadblocks: RoadblockSystem,
    private readonly cb: PoliceCallbacks,
  ) {
    this.group.name = 'dhaka-police-pursuit';
    this.graph = getLaneGraph();
    this.buildSharedMeshes();
    for (let i = 0; i < MAX_UNITS; i++) {
      this.units.push(this.createUnit(i));
    }
  }

  private buildSharedMeshes(): void {
    this.bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.redMat = new THREE.MeshBasicMaterial({ color: 0xff2438 });
    this.blueMat = new THREE.MeshBasicMaterial({ color: 0x248eff });

    // Serious Dhaka Police Patrol Pickup SUV (navy blue & white with bullbar & roof rack)
    const b = new Bucket('police-suv', this.bodyMat);
    b.box({ x: 0, y: 0.56, z: 0 }, { x: 1.76, y: 0.52, z: 4.18 }, '#102542'); // navy lower hull
    b.box({ x: 0, y: 0.62, z: 0.1 }, { x: 1.79, y: 0.16, z: 2.65 }, '#f8fafc'); // crisp white police stripe
    b.box({ x: 0, y: 1.14, z: 0.12 }, { x: 1.54, y: 0.62, z: 1.98 }, '#f8fafc'); // cabin
    b.box({ x: 0, y: 1.13, z: 0.12 }, { x: 1.56, y: 0.44, z: 1.56 }, '#1a3248'); // dark tinted windows
    b.box({ x: 0, y: 0.52, z: 2.14 }, { x: 1.58, y: 0.42, z: 0.12 }, '#1e242b'); // heavy front bullbar
    b.box({ x: 0, y: 1.49, z: 0.25 }, { x: 1.18, y: 0.08, z: 0.28 }, '#1e242b'); // lightbar base
    for (const [wx, wz] of [
      [-0.8, 1.32],
      [0.8, 1.32],
      [-0.8, -1.32],
      [0.8, -1.32],
    ]) {
      b.cylinder({ x: wx, y: 0.34, z: wz }, 0.34, 0.22, '#181b20', { z: Math.PI * 0.5 });
    }
    this.bodyGeo = b.build({ cast: false, receive: true })!.geometry;
    this.beaconGeo = new THREE.BoxGeometry(0.46, 0.14, 0.24);
  }

  private createUnit(idx: number): PoliceUnit {
    const g = new THREE.Group();
    g.visible = false;
    const body = new THREE.Mesh(this.bodyGeo, this.bodyMat);
    const beaconRed = new THREE.Mesh(this.beaconGeo, this.redMat);
    const beaconBlue = new THREE.Mesh(this.beaconGeo, this.blueMat);
    beaconRed.position.set(-0.32, 1.58, 0.25);
    beaconBlue.position.set(0.32, 1.58, 0.25);
    g.add(body, beaconRed, beaconBlue);
    this.group.add(g);

    return {
      active: false,
      aiState: 'searching',
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      speed: 0,
      lane: this.graph.lanes[idx % this.graph.lanes.length],
      s: 4,
      stuckTimer: 0,
      recoverTimer: 0,
      group: g,
      beaconRed,
      beaconBlue,
      halfWidth: 0.88,
      halfLength: 2.08,
    };
  }

  get currentPhase(): PursuitPhase {
    return this.phase;
  }

  get isActive(): boolean {
    return this.phase !== 'idle';
  }

  get heatLevel(): number {
    if (this.heatFloat < 1) return this.phase !== 'idle' ? 1 : 0;
    return clamp(Math.floor(this.heatFloat), 1, 5);
  }

  get rawHeat(): number {
    return this.heatFloat;
  }

  get evadeRatio(): number {
    return this.evadeProgress;
  }

  get bustedRatio(): number {
    return this.bustedProgress;
  }

  get nearestDistance(): number {
    return this.nearestUnitDist;
  }

  get activeUnitCount(): number {
    let n = 0;
    for (let i = 0; i < this.units.length; i++) if (this.units[i].active) n++;
    return n;
  }

  setSavedHeat(savedHeat: number): void {
    this.heatFloat = clamp(savedHeat, 0, 5);
  }

  /** Prewarm patrol SUV & lightbar shaders during boot so pursuit start is hitch-free. */
  withPrewarmState(run: () => void): void {
    const u = this.units[0];
    const prev = u.group.visible;
    u.group.visible = true;
    try {
      run();
    } finally {
      u.group.visible = prev;
    }
  }

  /** Record a reckless street infraction (smash prop, high-speed traffic ram). */
  recordInfraction(severity: number, px: number, pz: number, pyaw: number, roadRageActive: boolean): void {
    if (roadRageActive || this.postEscapeImmunity > 0) return;
    this.recklessAccumulator = clamp(this.recklessAccumulator + severity, 0, 10);

    if (this.phase === 'idle') {
      if (this.recklessAccumulator >= 2.8) {
        this.startPursuit(Math.max(1, Math.ceil(this.heatFloat)), px, pz, pyaw);
      }
    } else {
      const prevLevel = this.heatLevel;
      this.heatFloat = clamp(this.heatFloat + severity * 0.24, 1, 5);
      if (this.heatLevel > prevLevel) {
        this.cb.onHeatEscalated(this.heatLevel);
      }
      if (this.phase === 'losingSight' || this.phase === 'cooldown') {
        this.phase = 'pursuing';
        this.evadeProgress = Math.max(0, this.evadeProgress - 0.35);
      }
    }
  }

  /** Explicitly start a Police Pursuit at `initialHeat` (1..5), e.g. for Pursuit Escape events or tests. */
  startPursuit(initialHeat: number, px: number, pz: number, pyaw: number): void {
    const targetHeat = clamp(initialHeat, 1, 5);
    this.heatFloat = Math.max(this.heatFloat, targetHeat);
    this.phase = 'pursuing';
    this.evadeProgress = 0;
    this.bustedProgress = 0;
    this.pursuitDuration = 0;
    this.recklessAccumulator = 0;

    this.ensureUnitsForHeat(px, pz, pyaw);
    if (this.radioCooldown <= 0) {
      this.radioCooldown = 14;
      this.cb.onDispatchRadio();
    }
  }

  /** Cleanly stop pursuit and recycle all units & roadblocks (menu, mode reset, race end). */
  stopPursuit(resetHeat = false): void {
    this.phase = 'idle';
    this.evadeProgress = 0;
    this.bustedProgress = 0;
    this.pursuitDuration = 0;
    this.recklessAccumulator = 0;
    this.nearestUnitDist = 999;
    if (resetHeat) this.heatFloat = 0;
    for (let i = 0; i < this.units.length; i++) {
      this.units[i].active = false;
      this.units[i].group.visible = false;
      this.units[i].speed = 0;
    }
    this.roadblocks.clearAll();
  }

  getActiveSnapshots(): readonly PoliceUnitSnapshot[] {
    let n = 0;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.active) continue;
      this.snapshotsScratch[n++] = { x: u.x, z: u.z, yaw: u.yaw, state: u.aiState };
    }
    this.snapshotsScratch.length = n;
    return this.snapshotsScratch;
  }

  getActiveObbs(): readonly { cx: number; cz: number; halfX: number; halfZ: number; yaw: number }[] {
    let n = 0;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.active) continue;
      this.obbScratch[n++] = {
        cx: u.x,
        cz: u.z,
        halfX: u.halfWidth,
        halfZ: u.halfLength,
        yaw: u.yaw,
      };
    }
    this.obbScratch.length = n;
    return this.obbScratch;
  }

  private ensureUnitsForHeat(px: number, pz: number, pyaw: number): void {
    const desired = clamp(this.heatLevel, 1, MAX_UNITS);
    for (let i = 0; i < desired; i++) {
      const u = this.units[i];
      if (u.active) continue;
      this.spawnUnitNearPlayer(u, i, px, pz, pyaw);
    }
  }

  private spawnUnitNearPlayer(u: PoliceUnit, roleIdx: number, px: number, pz: number, pyaw: number): void {
    const fx = Math.sin(pyaw);
    const fz = Math.cos(pyaw);
    let bestLane = this.graph.lanes[0];
    let bestS = 6;
    let bestScore = -Infinity;

    for (let i = 0; i < this.graph.lanes.length; i++) {
      const l = this.graph.lanes[i];
      const midS = l.length * 0.5;
      const lx = l.ax + l.ux * midS;
      const lz = l.az + l.uz * midS;
      const dx = lx - px;
      const dz = lz - pz;
      const dist = Math.hypot(dx, dz);
      // Spawn 34m..78m away so units never pop right on top of the player!
      if (dist < 34 || dist > 78) continue;
      // Avoid spawning on top of another active unit
      if (this.units.some((o) => o.active && Math.hypot(o.x - lx, o.z - lz) < 12)) continue;

      const dotAhead = (dx / dist) * fx + (dz / dist) * fz;
      // Unit 0 spawns behind/flank to chase; higher units spawn ahead to intercept!
      const preferAhead = roleIdx >= 2 ? dotAhead : -dotAhead * 0.6;
      const score = preferAhead * 25 - Math.abs(dist - 48);
      if (score > bestScore) {
        bestScore = score;
        bestLane = l;
        bestS = clamp(midS, 4, Math.max(4, l.length - 4));
      }
    }

    u.active = true;
    u.aiState = roleIdx >= 2 ? 'intercepting' : 'pursuing';
    u.lane = bestLane;
    u.s = bestS;
    sampleLane(u.lane, u.s, 0, this.tmpPt);
    u.x = this.tmpPt.x;
    u.z = this.tmpPt.z;
    u.y = this.cb.heightAt(u.x, u.z);
    u.yaw = Math.atan2(px - u.x, pz - u.z);
    u.speed = 6.5;
    u.stuckTimer = 0;
    u.recoverTimer = 0;
    u.group.position.set(u.x, u.y, u.z);
    u.group.rotation.set(0, u.yaw, 0);
    u.group.visible = true;
  }

  update(
    dt: number,
    px: number,
    pz: number,
    pyaw: number,
    pspeed: number,
    roadRageActive: boolean,
  ): void {
    this.clock += dt;
    this.postEscapeImmunity = Math.max(0, this.postEscapeImmunity - dt);
    this.radioCooldown = Math.max(0, this.radioCooldown - dt);

    if (this.phase === 'idle') {
      this.recklessAccumulator = Math.max(0, this.recklessAccumulator - dt * 0.22);
      // Natural calm-driving Heat decay (Section 29.A)
      if (this.heatFloat > 0) {
        this.heatFloat = Math.max(0, this.heatFloat - dt * 0.025);
      }
      this.nearestUnitDist = 999;
      return;
    }

    if (roadRageActive) {
      // Yield cleanly if a street confrontation modal is open
      return;
    }

    this.pursuitDuration += dt;
    const prevLevel = this.heatLevel;
    // Gradual heat escalation from sustained high-pressure pursuit (1 level per ~45s + infractions)
    if (this.phase === 'pursuing') {
      this.heatFloat = clamp(this.heatFloat + dt * 0.022, 1, 5);
      if (this.heatLevel > prevLevel) {
        this.cb.onHeatEscalated(this.heatLevel);
        if (this.radioCooldown <= 0) {
          this.radioCooldown = 16;
          this.cb.onDispatchRadio();
        }
      }
    }

    const heat = this.heatLevel;
    this.ensureUnitsForHeat(px, pz, pyaw);

    // Check if player is currently threading a narrow Mohammadpur gali alley!
    const playerSeg = snapToNearestRoad(px, pz).segment;
    const playerInGali = playerSeg.kind === 'gali';
    const sightRange = playerInGali ? 37 : 58;

    const pfx = Math.sin(pyaw);
    const pfz = Math.cos(pyaw);
    const desiredRoadblocks = heat <= 1 ? 0 : Math.min(4, heat - 1);
    this.roadblocks.update(dt, px, pz, pfx, pfz, this.phase === 'pursuing' ? desiredRoadblocks : 0);

    const flashPhase = Math.floor(this.clock * 9.5) % 2 === 0;
    let minDist = 999;
    let anyHasLineOfSight = false;

    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.active) continue;

      u.beaconRed.visible = (i % 2 === 0) ? flashPhase : !flashPhase;
      u.beaconBlue.visible = !u.beaconRed.visible;

      const dxToPlayer = px - u.x;
      const dzToPlayer = pz - u.z;
      const dist = Math.hypot(dxToPlayer, dzToPlayer);
      if (dist < minDist) minDist = dist;

      // Relocate units stranded > 145m away so pursuit stays cohesive without teleporting onto player
      if (dist > 145) {
        this.spawnUnitNearPlayer(u, i, px, pz, pyaw);
        continue;
      }

      if (dist <= sightRange) {
        anyHasLineOfSight = true;
      }

      if (u.recoverTimer > 0) {
        u.aiState = 'recovering';
        u.recoverTimer = Math.max(0, u.recoverTimer - dt);
        u.speed = -2.6;
      } else if (!anyHasLineOfSight && dist > sightRange) {
        u.aiState = 'searching';
      } else {
        u.aiState = i >= 2 && dist > 20 ? 'intercepting' : 'pursuing';
      }

      // Target point: direct pursuit vs ahead-of-player intercept point!
      const leadDist = u.aiState === 'intercepting' ? Math.min(28, Math.abs(pspeed) * 2.2 + 12) : 0;
      const tx = px + pfx * leadDist;
      const tz = pz + pfz * leadDist;

      // Follow lane graph when > 24m away; blend direct pursuit steering within 24m
      const unitSeg = snapToNearestRoad(u.x, u.z).segment;
      const inGali = unitSeg.kind === 'gali';
      const baseTopSpeed = 8.4 + heat * 0.68; // 9.1 m/s (Heat 1) -> 11.8 m/s (Heat 5)
      const targetSpeed = u.recoverTimer > 0 ? -2.6 : baseTopSpeed * (inGali ? 0.68 : 1.0);

      let desiredYaw: number;
      if (dist > 26 && u.recoverTimer <= 0) {
        u.s += Math.max(2, u.speed) * dt;
        if (u.s >= u.lane.length - 2) {
          u.lane = this.pickBestOutgoingLane(u.lane, tx, tz);
          u.s = 1.5;
        }
        sampleLane(u.lane, u.s, 0, this.tmpPt);
        desiredYaw = Math.atan2(this.tmpPt.x - u.x, this.tmpPt.z - u.z);
      } else {
        desiredYaw = Math.atan2(tx - u.x, tz - u.z);
      }

      const dYaw = angleDelta(u.yaw, desiredYaw);
      const turnRate = (inGali ? 2.1 : 2.9) * dt;
      u.yaw = ((u.yaw + clamp(dYaw, -turnRate, turnRate)) % TAU + TAU) % TAU;
      u.speed += (targetSpeed - u.speed) * clamp01(dt * 3.8);

      const prevX = u.x;
      const prevZ = u.z;
      u.x += Math.sin(u.yaw) * u.speed * dt;
      u.z += Math.cos(u.yaw) * u.speed * dt;

      // Unit-vs-unit separation so patrol cars don't stack inside each other
      for (let j = 0; j < i; j++) {
        const o = this.units[j];
        if (!o.active) continue;
        const sx = u.x - o.x;
        const sz = u.z - o.z;
        const sd = Math.hypot(sx, sz);
        if (sd < 3.1 && sd > 0.001) {
          const push = (3.1 - sd) * 0.5;
          u.x += (sx / sd) * push;
          u.z += (sz / sd) * push;
          o.x -= (sx / sd) * push;
          o.z -= (sz / sd) * push;
        }
      }

      const moved = Math.hypot(u.x - prevX, u.z - prevZ);
      if (moved < 0.25 * dt && u.recoverTimer <= 0) {
        u.stuckTimer += dt;
        if (u.stuckTimer > 1.4) {
          u.recoverTimer = 0.75;
          u.stuckTimer = 0;
        }
      } else {
        u.stuckTimer = Math.max(0, u.stuckTimer - dt);
      }

      u.y = this.cb.heightAt(u.x, u.z);
      u.group.position.set(u.x, u.y, u.z);
      u.group.rotation.set(0, u.yaw, 0);
    }

    this.nearestUnitDist = minDist;

    // Pursuit State Machine transitions (Pursuing <-> LosingSight -> Cooldown -> Escaped)
    if (anyHasLineOfSight) {
      this.phase = 'pursuing';
      this.evadeProgress = Math.max(0, this.evadeProgress - dt * 0.42);
    } else {
      if (this.phase === 'pursuing') {
        this.phase = 'losingSight';
      }
      const evadeRate = playerInGali ? 0.22 : 0.15; // ~4.5s in gali, ~6.7s on avenue
      this.evadeProgress = clamp01(this.evadeProgress + dt * evadeRate);
      if (this.evadeProgress >= 0.48 && this.phase === 'losingSight') {
        this.phase = 'cooldown';
      }
      if (this.evadeProgress >= 1.0) {
        const escapedHeat = heat;
        const repEarned = 55 * escapedHeat;
        this.postEscapeImmunity = 12;
        this.heatFloat = Math.max(0, this.heatFloat - 0.85);
        this.stopPursuit(false);
        this.cb.onPursuitEscaped(escapedHeat, repEarned);
        return;
      }
    }

    // Busted check: boxed in within 3.3m at < 0.95 m/s continuously for 3.2s
    if (minDist <= 3.3 && Math.abs(pspeed) < 0.95 && anyHasLineOfSight) {
      this.bustedProgress = clamp01(this.bustedProgress + dt / 3.2);
      if (this.bustedProgress >= 1.0) {
        const bustedHeat = heat;
        this.postEscapeImmunity = 14;
        this.heatFloat = Math.max(0, this.heatFloat - 1.5);
        this.stopPursuit(false);
        this.cb.onPlayerBusted(bustedHeat, 45 * bustedHeat);
      }
    } else {
      this.bustedProgress = Math.max(0, this.bustedProgress - dt * 0.65);
    }
  }

  private pickBestOutgoingLane(current: LaneEdge, tx: number, tz: number): LaneEdge {
    const ids = current.nextLaneIds;
    if (ids.length === 0) return current;
    let best = this.graph.byId.get(ids[0]) ?? current;
    let bestDist = Infinity;
    for (let i = 0; i < ids.length; i++) {
      const cand = this.graph.byId.get(ids[i]);
      if (!cand) continue;
      const d = Math.hypot(cand.bx - tx, cand.bz - tz);
      if (d < bestDist) {
        bestDist = d;
        best = cand;
      }
    }
    return best;
  }

  /** Resolve player rickshaw vs active police patrol SUV OBBs. */
  resolvePlayerCollision(
    rx: number,
    rz: number,
    ryaw: number,
    rspeed: number,
  ): {
    hit: boolean;
    pushX: number;
    pushZ: number;
    nx: number;
    nz: number;
    contactX: number;
    contactZ: number;
    closingSpeed: number;
  } {
    let hitAny = false;
    let pushX = 0;
    let pushZ = 0;
    let nx = 0;
    let nz = 0;
    let contactX = rx;
    let contactZ = rz;
    let closingSpeed = 0;

    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (!u.active) continue;
      const h = testRickshawCapsuleVsObb(
        rx + pushX,
        rz + pushZ,
        ryaw,
        u.x,
        u.z,
        u.halfWidth,
        u.halfLength,
        u.yaw,
      );
      if (!h.hit) continue;
      hitAny = true;
      pushX += h.pushX * 0.72;
      pushZ += h.pushZ * 0.72;
      u.x -= h.pushX * 0.28;
      u.z -= h.pushZ * 0.28;
      nx = h.nx;
      nz = h.nz;
      contactX = h.contactX;
      contactZ = h.contactZ;
      const relVx = Math.sin(ryaw) * rspeed - Math.sin(u.yaw) * u.speed;
      const relVz = Math.cos(ryaw) * rspeed - Math.cos(u.yaw) * u.speed;
      const cSpd = Math.abs(relVx * h.nx + relVz * h.nz);
      if (cSpd > closingSpeed) closingSpeed = cSpd;
    }

    return { hit: hitAny, pushX, pushZ, nx, nz, contactX, contactZ, closingSpeed };
  }

  dispose(): void {
    this.stopPursuit(true);
    this.group.clear();
    this.bodyGeo.dispose();
    this.beaconGeo.dispose();
    this.bodyMat.dispose();
    this.redMat.dispose();
    this.blueMat.dispose();
  }
}
