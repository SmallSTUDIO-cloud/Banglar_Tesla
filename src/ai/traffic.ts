/**
 * Mohammadpur Traffic & Emergent Dhaka Traffic-Jam Simulation (Sections 8, 14, 15).
 *
 * Key behaviours:
 *   - High density of Bangladeshi NPC passenger cycle rickshaws (~36%) plus
 *     battery EasyBikes, green CNGs, Mohammadpur buses, sedans, painted trucks,
 *     parcel vans, and commuter motorbikes.
 *   - Graph-driven navigation across all Mohammadpur street lanes (`routes.ts`).
 *   - Realistic severe-but-recoverable Dhaka traffic jams around Town Hall,
 *     Mohammadpur Bus Stand, Shia Mosque, and signalised intersections via
 *     bus-stop passenger dwell, market loading pauses, and signal phases —
 *     while guaranteeing zero permanent gridlock via stuck-release timers and
 *     leaving alternate side streets navigable for smart detours.
 *   - Rendered via `InstancedTrafficFleet` (20 shared GPU-instanced meshes,
 *     zero per-vehicle scene hierarchy or duplicate materials, zero per-frame
 *     heap allocations).
 */

import * as THREE from 'three';
import type { QualitySettings } from '../core/config';
import { angleDelta, clamp, damp, mulberry32 } from '../core/mathx';
import { SIGNALS } from '../world/layout';
import { getLaneGraph, sampleLane, type LaneEdge, type LaneGraph, type LanePoint } from './routes';
import {
  InstancedTrafficFleet,
  getTrafficArchetype,
  type InstancedVehicleState,
  type TrafficArchetype,
  type TrafficType,
} from './vehicles';

export type VehicleKind = TrafficType;

export interface TrafficObstacle {
  x: number;
  z: number;
  radius: number;
  halfWidth: number;
  halfLength: number;
  kind: VehicleKind;
  agentIndex: number;
  speed: number;
  yaw: number;
}

interface ActiveTrafficAgent extends InstancedVehicleState {
  arch: TrafficArchetype;
  lane: LaneEdge;
  s: number;
  speed: number;
  cruise: number;
  lateralOffset: number;
  targetLateral: number;
  dwellTimer: number;
  dwellCooldown: number;
  stuckTimer: number;
  honkTimer: number;
  farAccum: number;
  roadRageHold: number;
  rageImmuneTimer: number;
}

const FLEET_DISTRIBUTION: { kind: VehicleKind; weight: number; cruiseMin: number; cruiseMax: number }[] = [
  { kind: 'rickshaw', weight: 0.36, cruiseMin: 3.4, cruiseMax: 5.1 },
  { kind: 'cng', weight: 0.18, cruiseMin: 5.8, cruiseMax: 8.2 },
  { kind: 'easybike', weight: 0.13, cruiseMin: 4.8, cruiseMax: 6.8 },
  { kind: 'car', weight: 0.11, cruiseMin: 6.2, cruiseMax: 8.8 },
  { kind: 'bus', weight: 0.09, cruiseMin: 5.2, cruiseMax: 7.4 },
  { kind: 'motorbike', weight: 0.07, cruiseMin: 6.8, cruiseMax: 9.6 },
  { kind: 'van', weight: 0.03, cruiseMin: 5.4, cruiseMax: 7.5 },
  { kind: 'truck', weight: 0.03, cruiseMin: 4.9, cruiseMax: 6.8 },
];

export class TrafficSystem {
  readonly group = new THREE.Group();
  private fleet: InstancedTrafficFleet;
  private graph: LaneGraph;
  private busyLanes: LaneEdge[];
  private signalByNode = new Map<string, (typeof SIGNALS)[number]>();
  private agents: ActiveTrafficAgent[] = [];
  private laneOccupancy = new Map<string, ActiveTrafficAgent[]>();
  private segmentCongestion = new Map<string, number>();
  private jammedListCache: string[] = [];
  private wideLaneScratch: LaneEdge[] = [];
  private obstaclePool: TrafficObstacle[] = [];
  private activeObstacles: TrafficObstacle[] = [];
  private rng = mulberry32(88421);
  private tmpPt: LanePoint = { x: 0, z: 0, yaw: 0 };

  private clock = 0;
  private hornCooldown = 0;
  private playerX = 0;
  private playerZ = 0;
  private viewDistSq = 185 * 185;
  private heightAt: (x: number, z: number) => number = () => 0.014;
  congestionEpoch = 1;

  onHorn?: (x: number, z: number, kind: VehicleKind) => void;

  constructor(quality: QualitySettings, heightAt?: (x: number, z: number) => number) {
    this.group.name = 'mohammadpur-traffic';
    this.graph = getLaneGraph();
    this.busyLanes = this.graph.lanes.filter((l) => l.jamProne || l.kind !== 'gali');
    if (this.busyLanes.length === 0) this.busyLanes = this.graph.lanes;
    for (const sig of SIGNALS) this.signalByNode.set(sig.nodeId, sig);

    if (heightAt) this.heightAt = heightAt;
    for (const lane of this.graph.lanes) {
      this.laneOccupancy.set(lane.id, []);
    }
    this.fleet = new InstancedTrafficFleet(this.group, 56);
    this.setQuality(quality);
  }

  get vehicleCount(): number {
    return this.agents.length;
  }

  withPrewarmState(run: () => void): void {
    this.fleet.withPrewarmState(run);
  }

  setHeightSampler(fn: (x: number, z: number) => number): void {
    this.heightAt = fn;
  }

  setPlayer(x: number, z: number, _speed: number): void {
    this.playerX = x;
    this.playerZ = z;
  }

  setQuality(quality: QualitySettings): void {
    const visR = Math.max(120, quality.viewDistance + 15);
    this.viewDistSq = visR * visR;
    const target = Math.max(8, quality.trafficCount);
    while (this.agents.length > target) {
      this.agents.pop();
    }
    while (this.agents.length < target) {
      this.agents.push(this.spawnAgent(this.agents.length));
    }
    this.fleet.sync(this.agents);
  }

  private pickVehicleSpec(narrowLane: boolean): (typeof FLEET_DISTRIBUTION)[number] {
    let r = this.rng();
    for (let i = 0; i < FLEET_DISTRIBUTION.length; i++) {
      const item = FLEET_DISTRIBUTION[i];
      if (narrowLane && (item.kind === 'bus' || item.kind === 'truck')) continue;
      if (r <= item.weight) return item;
      r -= item.weight;
    }
    return FLEET_DISTRIBUTION[0];
  }

  private pickSpawnLane(preferBusy: boolean): LaneEdge {
    const arr = preferBusy ? this.busyLanes : this.graph.lanes;
    return arr[Math.floor(this.rng() * arr.length)];
  }

  private spawnAgent(index: number): ActiveTrafficAgent {
    const lane = this.pickSpawnLane(index % 3 !== 0);
    const spec = this.pickVehicleSpec(lane.kind === 'gali');
    const arch = getTrafficArchetype(spec.kind);
    const variant = Math.floor(this.rng() * arch.schemes.length);
    const s = this.rng() * Math.max(1, lane.length - 4);
    const lateral =
      spec.kind === 'rickshaw' || spec.kind === 'motorbike'
        ? (this.rng() - 0.5) * 0.65
        : (this.rng() - 0.5) * 0.22;

    sampleLane(lane, s, lateral, this.tmpPt);
    const gy = this.heightAt(this.tmpPt.x, this.tmpPt.z);

    return {
      kind: spec.kind,
      arch,
      variant,
      lane,
      s,
      speed: spec.cruiseMin * 0.6,
      cruise: spec.cruiseMin + this.rng() * (spec.cruiseMax - spec.cruiseMin),
      wheelSpin: 0,
      x: this.tmpPt.x,
      y: gy,
      z: this.tmpPt.z,
      yaw: this.tmpPt.yaw,
      braking: false,
      visible: true,
      nearLod: true,
      lateralOffset: lateral,
      targetLateral: lateral,
      dwellTimer: 0,
      dwellCooldown: 5 + this.rng() * 14,
      stuckTimer: 0,
      honkTimer: 1 + this.rng() * 5,
      farAccum: (index % 5) * 0.016,
      roadRageHold: 0,
      rageImmuneTimer: 0,
    };
  }

  private isSignalRedForLane(lane: LaneEdge): boolean {
    if (!lane.toSignal || !lane.signalNodeId) return false;
    const sig = this.signalByNode.get(lane.signalNodeId);
    if (!sig) return false;
    const t = (this.clock + sig.offset) % sig.cycle;
    const eastWest = Math.abs(lane.ux) >= Math.abs(lane.uz);
    if (eastWest) return t >= 11;
    return t < 12 || t >= 23;
  }

  getCongestionMultiplier(segmentId: string): number {
    return this.segmentCongestion.get(segmentId) ?? 1.0;
  }

  getJammedSegments(): string[] {
    let changed = false;
    let count = 0;
    for (const [segId, mult] of this.segmentCongestion) {
      if (mult >= 2.1) {
        if (this.jammedListCache[count] !== segId) {
          this.jammedListCache[count] = segId;
          changed = true;
        }
        count++;
      }
    }
    if (this.jammedListCache.length !== count) {
      this.jammedListCache.length = count;
      changed = true;
    }
    if (changed) this.congestionEpoch++;
    return this.jammedListCache;
  }

  obstacles(): readonly TrafficObstacle[] {
    let n = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.visible) continue;
      const dx = a.x - this.playerX;
      const dz = a.z - this.playerZ;
      if (dx * dx + dz * dz > 26 * 26) continue;
      let ob = this.obstaclePool[n];
      if (!ob) {
        ob = {
          x: a.x,
          z: a.z,
          radius: a.arch.radius,
          halfWidth: a.arch.halfWidth,
          halfLength: a.arch.halfLength,
          kind: a.kind,
          agentIndex: i,
          speed: a.speed,
          yaw: a.yaw,
        };
        this.obstaclePool.push(ob);
      } else {
        ob.x = a.x;
        ob.z = a.z;
        ob.radius = a.arch.radius;
        ob.halfWidth = a.arch.halfWidth;
        ob.halfLength = a.arch.halfLength;
        ob.kind = a.kind;
        ob.agentIndex = i;
        ob.speed = a.speed;
        ob.yaw = a.yaw;
      }
      this.activeObstacles[n] = ob;
      n++;
    }
    this.activeObstacles.length = n;
    return this.activeObstacles;
  }

  /** One-shot recovery clearance check across all active vehicles (zero per-frame cost). */
  isClearForRecovery(cx: number, cz: number, fx: number, fz: number): boolean {
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const dx = a.x - cx;
      const dz = a.z - cz;
      const r = a.arch.radius;
      if (dx * dx + dz * dz < (r + 5.0) * (r + 5.0)) return false;
      const fwd = dx * fx + dz * fz;
      const lat = Math.abs(dx * fz - dz * fx);
      if (fwd > -4 && fwd < 26 && lat < r + 4.2) return false;
    }
    return true;
  }

  reactToBell(x: number, z: number): void {
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const dx = a.x - x;
      const dz = a.z - z;
      if (dx * dx + dz * dz < 16 * 16 && (a.kind === 'rickshaw' || a.kind === 'motorbike' || a.kind === 'cng')) {
        a.targetLateral = clamp(a.lateralOffset + (a.lateralOffset >= 0 ? 0.55 : -0.55), -1.0, 1.0);
        if (a.dwellTimer > 0.6) a.dwellTimer = 0.6;
      }
    }
  }

  update(dt: number): void {
    this.clock += dt;
    this.hornCooldown = Math.max(0, this.hornCooldown - dt);

    for (const list of this.laneOccupancy.values()) list.length = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      this.laneOccupancy.get(a.lane.id)!.push(a);
    }

    for (const [segId, val] of this.segmentCongestion) {
      const next = 1 + (val - 1) * Math.exp(-dt * 1.4);
      if (next <= 1.03) this.segmentCongestion.delete(segId);
      else this.segmentCongestion.set(segId, next);
    }

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a.rageImmuneTimer > 0) a.rageImmuneTimer = Math.max(0, a.rageImmuneTimer - dt);
      const dxP = a.x - this.playerX;
      const dzP = a.z - this.playerZ;
      const distSqToPlayer = dxP * dxP + dzP * dzP;

      if (a.roadRageHold <= 0 && distSqToPlayer > 225 * 225) {
        this.relocateNearPlayer(a);
      }

      a.visible = distSqToPlayer < this.viewDistSq;
      // Hysteresis band [76m .. 86m] for wheel/lamp instance emission so wheels never pop!
      if (a.nearLod) {
        if (distSqToPlayer > 86 * 86) a.nearLod = false;
      } else if (distSqToPlayer < 76 * 76) {
        a.nearLod = true;
      }

      if (a.roadRageHold > 0) {
        a.roadRageHold = Math.max(0, a.roadRageHold - dt);
        a.targetLateral = clamp(a.lane.halfRoadWidth * 0.36, 0.35, 1.15);
        a.lateralOffset = damp(a.lateralOffset, a.targetLateral, 4.2, dt);
        a.speed = Math.max(0, a.speed - 7.5 * dt);
        a.s = Math.min(a.lane.length - 0.5, a.s + a.speed * dt);
        a.stuckTimer = 0;
        sampleLane(a.lane, a.s, a.lateralOffset, this.tmpPt);
        a.x = this.tmpPt.x;
        a.z = this.tmpPt.z;
        a.yaw += angleDelta(a.yaw, this.tmpPt.yaw + 0.08) * (1 - Math.exp(-8 * dt));
        if (a.visible) {
          a.y = this.heightAt(a.x, a.z);
          a.braking = Math.floor(this.clock * 4) % 2 === 0;
        }
        continue;
      }

      // Multi-rate AI: beyond 105m run full car-following AI at ~12 Hz while smoothly
      // extrapolating position along current heading on intermediate frames!
      let stepDt = dt;
      if (distSqToPlayer > 105 * 105) {
        a.farAccum += dt;
        if (a.farAccum < 0.08) {
          if (a.visible && a.speed > 0.05) {
            a.x += Math.sin(a.yaw) * a.speed * dt;
            a.z += Math.cos(a.yaw) * a.speed * dt;
          }
          continue;
        }
        stepDt = a.farAccum;
        a.farAccum = 0;
      }

      a.dwellCooldown = Math.max(0, a.dwellCooldown - stepDt);
      if (a.dwellTimer > 0) {
        a.dwellTimer = Math.max(0, a.dwellTimer - stepDt);
      } else if (
        a.dwellCooldown <= 0 &&
        a.lane.jamProne &&
        a.s > 8 &&
        a.s < a.lane.length - 10 &&
        (a.kind === 'bus' || a.kind === 'cng' || a.kind === 'van' || a.kind === 'rickshaw') &&
        this.rng() < stepDt * (a.kind === 'bus' ? 0.55 : 0.16)
      ) {
        a.dwellTimer = a.kind === 'bus' ? 5.2 + this.rng() * 3.2 : 3.0 + this.rng() * 2.5;
        a.dwellCooldown = 22 + this.rng() * 20;
        a.targetLateral = clamp(a.lane.halfRoadWidth * 0.22, 0.2, 0.9);
      }

      let minGap = 999;
      let blockerLateral = 0;
      const sameLane = this.laneOccupancy.get(a.lane.id)!;
      for (let j = 0; j < sameLane.length; j++) {
        const other = sameLane[j];
        if (other === a) continue;
        const ahead = other.s - a.s;
        if (ahead > 0.05 && ahead < 28) {
          const latSep = Math.abs(other.lateralOffset - a.lateralOffset);
          const minLatClear = (other.arch.halfWidth + a.arch.halfWidth) * 0.92;
          if (latSep < minLatClear) {
            const netGap = ahead - (other.arch.halfLength + a.arch.halfLength + 0.85);
            if (netGap < minGap) {
              minGap = netGap;
              blockerLateral = other.lateralOffset;
            }
          }
        }
      }

      const distToNode = a.lane.length - a.s;
      if (distToNode < 14 && a.lane.nextLaneIds.length > 0) {
        for (let k = 0; k < a.lane.nextLaneIds.length; k++) {
          const nextOcc = this.laneOccupancy.get(a.lane.nextLaneIds[k]);
          if (!nextOcc) continue;
          for (let j = 0; j < nextOcc.length; j++) {
            const other = nextOcc[j];
            if (other.s < 9) {
              const netGap = distToNode + other.s - (other.arch.halfLength + a.arch.halfLength + 0.9);
              if (netGap < minGap) minGap = netGap;
            }
          }
        }
      }

      if (distSqToPlayer < 18 * 18) {
        const fx = Math.sin(a.yaw);
        const fz = Math.cos(a.yaw);
        const dx = this.playerX - a.x;
        const dz = this.playerZ - a.z;
        const aheadDot = dx * fx + dz * fz;
        const latDot = Math.abs(dx * fz - dz * fx);
        if (aheadDot > 0.4 && latDot < a.arch.halfWidth + 1.05) {
          minGap = Math.min(minGap, aheadDot - (a.arch.halfLength + 1.35));
        }
      }

      const redSignal =
        a.stuckTimer < 8.5 &&
        distToNode > 1.8 &&
        distToNode < 9.5 &&
        this.isSignalRedForLane(a.lane);
      if (redSignal) {
        minGap = Math.min(minGap, distToNode - 2.6);
      }

      if (
        minGap < 4.5 &&
        a.dwellTimer <= 0 &&
        a.lane.kind === 'main' &&
        (a.kind === 'rickshaw' || a.kind === 'motorbike')
      ) {
        a.targetLateral = blockerLateral >= 0 ? -0.85 : 0.75;
      } else if (a.dwellTimer <= 0 && minGap > 10) {
        a.targetLateral = damp(a.targetLateral, 0, 0.8, stepDt);
      }
      a.lateralOffset = damp(a.lateralOffset, a.targetLateral, 2.6, stepDt);

      if (a.speed < 0.25 && a.dwellTimer <= 0) {
        a.stuckTimer += stepDt;
      } else {
        a.stuckTimer = Math.max(0, a.stuckTimer - stepDt * 1.5);
      }

      let desiredSpeed = a.dwellTimer > 0 ? 0 : a.cruise;
      if (a.lane.jamProne) desiredSpeed *= 0.86;
      if (minGap < 15) {
        desiredSpeed = Math.min(desiredSpeed, Math.max(0, minGap * 0.72));
      }
      if (a.stuckTimer > 8.5) {
        desiredSpeed = Math.max(desiredSpeed, 1.35);
        if (a.stuckTimer > 13.5) a.stuckTimer = 0;
      }

      const accel = clamp(desiredSpeed - a.speed, -6.8, 2.8);
      a.speed = clamp(a.speed + accel * stepDt, 0, a.cruise + 0.8);
      a.s += a.speed * stepDt;

      if (a.s >= a.lane.length) {
        const over = a.s - a.lane.length;
        a.lane = this.chooseNextLane(a);
        a.s = Math.min(over, a.lane.length * 0.4);
      }

      if (a.speed < a.cruise * 0.42) {
        const prev = this.segmentCongestion.get(a.lane.segmentId) ?? 1.0;
        this.segmentCongestion.set(a.lane.segmentId, Math.min(4.8, prev + 0.68));
      }

      a.honkTimer = Math.max(0, a.honkTimer - stepDt);
      if (minGap < 3.2 && a.dwellTimer <= 0 && a.honkTimer <= 0 && this.hornCooldown <= 0 && distSqToPlayer < 48 * 48) {
        a.honkTimer = 5 + this.rng() * 8;
        this.hornCooldown = 2.1;
        this.onHorn?.(a.x, a.z, a.kind);
      }

      sampleLane(a.lane, a.s, a.lateralOffset, this.tmpPt);
      a.x = this.tmpPt.x;
      a.z = this.tmpPt.z;
      a.yaw += angleDelta(a.yaw, this.tmpPt.yaw) * (1 - Math.exp(-9 * stepDt));

      if (a.visible) {
        // Only sample heightAt when moving or near bumps; stationary vehicles keep cached ground Y!
        if (a.speed > 0.05 || a.y === 0) {
          a.y = this.heightAt(a.x, a.z);
        }
        if (a.nearLod && a.speed > 0.02) {
          a.wheelSpin += (a.speed * stepDt) / a.arch.wheelRadius;
        }
        a.braking = a.speed < 0.45 || accel < -1.1;
      }
    }

    this.fleet.sync(this.agents);
  }

  private chooseNextLane(a: ActiveTrafficAgent): LaneEdge {
    const ids = a.lane.nextLaneIds;
    if (ids.length === 0) return a.lane;
    if (a.kind === 'bus' || a.kind === 'truck') {
      let wideCount = 0;
      for (let i = 0; i < ids.length; i++) {
        const l = this.graph.byId.get(ids[i]);
        if (l && l.kind !== 'gali') {
          this.wideLaneScratch[wideCount++] = l;
        }
      }
      if (wideCount > 0) {
        return this.wideLaneScratch[Math.floor(this.rng() * wideCount)];
      }
    }
    const chosenId = ids[Math.floor(this.rng() * ids.length)];
    return this.graph.byId.get(chosenId) ?? a.lane;
  }

  private relocateNearPlayer(a: ActiveTrafficAgent): void {
    for (let attempt = 0; attempt < 8; attempt++) {
      const cand = this.graph.lanes[Math.floor(this.rng() * this.graph.lanes.length)];
      if ((a.kind === 'bus' || a.kind === 'truck') && cand.kind === 'gali') continue;
      const mx = (cand.ax + cand.bx) * 0.5;
      const mz = (cand.az + cand.bz) * 0.5;
      const d = Math.hypot(mx - this.playerX, mz - this.playerZ);
      if (d > 82 && d < 162) {
        a.lane = cand;
        a.s = this.rng() * cand.length * 0.8;
        sampleLane(a.lane, a.s, a.lateralOffset, this.tmpPt);
        a.x = this.tmpPt.x;
        a.z = this.tmpPt.z;
        a.y = this.heightAt(a.x, a.z);
        a.yaw = this.tmpPt.yaw;
        a.stuckTimer = 0;
        return;
      }
    }
  }

  canTriggerRoadRage(agentIndex: number): boolean {
    const a = this.agents[agentIndex];
    return !!a && a.kind === 'car' && a.roadRageHold <= 0 && a.rageImmuneTimer <= 0;
  }

  pullOverCar(agentIndex: number, holdSeconds = 45): { x: number; y: number; z: number; yaw: number } | null {
    const a = this.agents[agentIndex];
    if (!a || a.kind !== 'car') return null;
    a.roadRageHold = holdSeconds;
    a.dwellTimer = 0;
    return { x: a.x, y: a.y, z: a.z, yaw: a.yaw };
  }

  releaseCar(agentIndex: number, immuneSeconds = 18): void {
    const a = this.agents[agentIndex];
    if (!a) return;
    a.roadRageHold = 0;
    a.rageImmuneTimer = immuneSeconds;
  }

  getAgentPose(agentIndex: number): { x: number; y: number; z: number; yaw: number; kind: VehicleKind } | null {
    const a = this.agents[agentIndex];
    if (!a) return null;
    return { x: a.x, y: a.y, z: a.z, yaw: a.yaw, kind: a.kind };
  }

  /**
   * Deterministic test helper: position an existing `car` (or `nonCarKind`) agent
   * at a known road point near the player without allocating extra fleet instances.
   */
  debugPositionAgentForTest(
    kind: VehicleKind,
    x: number,
    z: number,
    yaw: number,
    speed = 0,
  ): number {
    let idx = this.agents.findIndex((a) => a.kind === kind && a.roadRageHold <= 0);
    if (idx < 0 && this.agents.length > 0) {
      idx = this.agents.length - 1;
      const arch = getTrafficArchetype(kind);
      this.agents[idx].kind = kind;
      this.agents[idx].arch = arch;
      this.agents[idx].variant = 0;
    }
    if (idx < 0) return -1;
    const a = this.agents[idx];
    // Pick nearest lane so lane update stays coherent
    let bestLane = this.graph.lanes[0];
    let bestD = Infinity;
    let bestS = 4;
    for (let i = 0; i < this.graph.lanes.length; i++) {
      const l = this.graph.lanes[i];
      const along = clamp((x - l.ax) * l.ux + (z - l.az) * l.uz, 2, Math.max(2, l.length - 2));
      const px = l.ax + l.ux * along;
      const pz = l.az + l.uz * along;
      const d = (px - x) * (px - x) + (pz - z) * (pz - z);
      if (d < bestD) {
        bestD = d;
        bestLane = l;
        bestS = along;
      }
    }
    a.lane = bestLane;
    a.s = bestS;
    a.lateralOffset = 0;
    a.targetLateral = 0;
    a.x = x;
    a.z = z;
    a.y = this.heightAt(x, z);
    a.yaw = yaw;
    a.speed = speed;
    a.dwellTimer = speed <= 0.25 ? 2.0 : 0;
    a.visible = true;
    a.nearLod = true;
    a.roadRageHold = 0;
    a.rageImmuneTimer = 0;
    this.fleet.sync(this.agents);
    return idx;
  }

  dispose(): void {
    this.agents.length = 0;
    this.group.clear();
  }
}
