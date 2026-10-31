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

/** Signed forward corridor: rear and side approaches cannot trigger a stop. */
export function forwardPlayerGap(
  npcX: number, npcZ: number, yaw: number, halfWidth: number, halfLength: number,
  playerX: number, playerZ: number, lookAhead = 18,
): number | null {
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const dx = playerX - npcX, dz = playerZ - npcZ;
  const forward = dx * fx + dz * fz;
  const lateral = Math.abs(dx * fz - dz * fx);
  if (forward <= 0.4 || forward >= lookAhead || lateral >= halfWidth + 1.05) return null;
  return forward - (halfLength + 1.35);
}

/** Smooth quiet-hours population: no hard cut at midnight or 07:00. */
export function quietTrafficFactor(minutes: number): number {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m < 210) return 0.9 - (m / 210) * 0.45;
  if (m < 300) return 0.45;
  if (m < 420) return 0.45 + ((m - 300) / 120) * 0.55;
  if (m < 1320) return 1;
  return 1 - ((m - 1320) / 120) * 0.1;
}

export type VehicleKind = TrafficType;

/** Suspension response varies with wheelbase/mass, bounded so no AI launches. */
export function npcPotholeResponse(kind: VehicleKind, speed: number, depth: number): number {
  const multiplier: Record<VehicleKind, number> = {
    motorbike: 1.1, rickshaw: 1, easybike: 0.85, cng: 0.78,
    car: 0.72, van: 0.65, truck: 0.5, bus: 0.42,
  };
  return Math.min(0.075, Math.max(0, depth) * Math.min(1.3, Math.abs(speed) / 6) * multiplier[kind]);
}


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
  /** Chosen before reaching the junction; blocking and turn speed use this route. */
  plannedLaneId: string | null;
  /** Connector across a junction, entered before the source lane ends. */
  turnLane: LaneEdge | null;
  turnT: number;
  turnLead: number;
  /** Damp lateral discontinuity at lane junctions without jumping the vehicle. */
  turnOffsetX: number;
  turnOffsetZ: number;
  potholeDepth: number;
  bumpOffset: number;
  /** Bounded, lane-aligned contact displacement; never changes route decisions. */
  contactTravel: number;
  contactSideTravel: number;
  contactCooldown: number;
  roadRageHold: number;
  rageImmuneTimer: number;
}

/** Class-specific response limits; speeds still come from the existing fleet distribution. */
const CONTACT_RESPONSE: Record<VehicleKind, number> = {
  rickshaw: 0.8, cng: 0.7, easybike: 0.75, motorbike: 0.65,
  car: 1, van: 0.48, bus: 0.12, truck: 0.15,
};

const HANDLING: Record<VehicleKind, { accel: number; brake: number; headway: number; turn: number; yaw: number }> = {
  bus:       { accel: 1.35, brake: 4.0, headway: 1.9, turn: 2.65, yaw: 0.85 },
  truck:     { accel: 1.5,  brake: 4.3, headway: 1.8, turn: 2.8,  yaw: 0.9 },
  van:       { accel: 2.0,  brake: 5.2, headway: 1.45,turn: 3.5,  yaw: 1.25 },
  car:       { accel: 2.65, brake: 6.2, headway: 1.2, turn: 4.2,  yaw: 1.55 },
  cng:       { accel: 2.25, brake: 5.8, headway: 1.25,turn: 4.3,  yaw: 1.6 },
  easybike:  { accel: 1.5,  brake: 4.7, headway: 1.35,turn: 3.5,  yaw: 1.5 },
  rickshaw:  { accel: 1.1,  brake: 4.4, headway: 1.45,turn: 3.1,  yaw: 1.35 },
  motorbike: { accel: 2.8,  brake: 6.4, headway: 1.05,turn: 5.0,  yaw: 1.85 },
};

/** Cubic connector with heading-continuous entrance and exit. Reuses caller scratch. */
function sampleJunction(from: LaneEdge, to: LaneEdge, lead: number, lateral: number, t: number, out: LanePoint): number {
  const sx = from.bx - from.ux * lead + from.uz * lateral;
  const sz = from.bz - from.uz * lead - from.ux * lateral;
  const ex = to.ax + to.ux * lead + to.uz * lateral;
  const ez = to.az + to.uz * lead - to.ux * lateral;
  const control = lead * 0.85;
  const c1x = sx + from.ux * control, c1z = sz + from.uz * control;
  const c2x = ex - to.ux * control, c2z = ez - to.uz * control;
  const u = 1 - t, uu = u * u, tt = t * t;
  out.x = uu * u * sx + 3 * uu * t * c1x + 3 * u * tt * c2x + tt * t * ex;
  out.z = uu * u * sz + 3 * uu * t * c1z + 3 * u * tt * c2z + tt * t * ez;
  const vx = 3 * uu * (c1x - sx) + 6 * u * t * (c2x - c1x) + 3 * tt * (ex - c2x);
  const vz = 3 * uu * (c1z - sz) + 6 * u * t * (c2z - c1z) + 3 * tt * (ez - c2z);
  out.yaw = Math.atan2(vx, vz);
  return Math.max(0.3, Math.hypot(vx, vz));
}

function junctionLead(from: LaneEdge, to: LaneEdge, kind: VehicleKind): number {
  return Math.min(kind === 'bus' || kind === 'truck' ? 8 : 5.5, from.length * 0.35, to.length * 0.35);
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
  private incomingByNode = new Map<string, LaneEdge[]>();
  private segmentCongestion = new Map<string, number>();
  private jammedListCache: string[] = [];
  private wideLaneScratch: LaneEdge[] = [];
  private obstaclePool: TrafficObstacle[] = [];
  private activeObstacles: TrafficObstacle[] = [];
  private rng = mulberry32(88421);
  private debugSimFrozen = false;
  private tmpPt: LanePoint = { x: 0, z: 0, yaw: 0 };

  private clock = 0;
  private hornCooldown = 0;
  private playerX = 0;
  private playerZ = 0;
  private playerSpeed = 0;
  private playerYaw = 0;
  private viewDistSq = 185 * 185;
  private baseTrafficCount = 32;
  private quietFactor = 1;
  private populationTick = 0;
  private heightAt: (x: number, z: number) => number = () => 0.014;
  private potholeAt: (x: number, z: number) => number = () => 0;
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
      let incoming = this.incomingByNode.get(lane.toNode);
      if (!incoming) {
        incoming = [];
        this.incomingByNode.set(lane.toNode, incoming);
      }
      incoming.push(lane);
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

  setPotholeSampler(fn: (x: number, z: number) => number): void {
    this.potholeAt = fn;
  }

  setHeightSampler(fn: (x: number, z: number) => number): void {
    this.heightAt = fn;
  }

  setPlayer(x: number, z: number, speed: number, yaw = 0): void {
    this.playerX = x;
    this.playerZ = z;
    this.playerSpeed = speed;
    this.playerYaw = yaw;
  }

  setQuality(quality: QualitySettings): void {
    const visR = Math.max(120, quality.viewDistance + 15);
    this.viewDistSq = visR * visR;
    this.baseTrafficCount = quality.trafficCount;
    const target = Math.max(8, Math.round(quality.trafficCount * this.quietFactor));
    while (this.agents.length > target) {
      this.agents.pop();
    }
    while (this.agents.length < target) {
      this.agents.push(this.spawnAgent(this.agents.length));
    }
    this.fleet.sync(this.agents);
  }

  setTimeMinutes(minutes: number): void {
    this.quietFactor = quietTrafficFactor(minutes);
  }

  private adjustPopulation(dt: number): void {
    this.populationTick += dt;
    if (this.populationTick < 2) return;
    this.populationTick = 0;
    const target = Math.max(8, Math.round(this.baseTrafficCount * this.quietFactor));
    if (this.agents.length < target) {
      this.agents.push(this.spawnAgent(this.agents.length));
    } else if (this.agents.length > target) {
      const last = this.agents[this.agents.length - 1];
      // Keep near traffic in place, especially during a player collision or race.
      if (Math.hypot(last.x - this.playerX, last.z - this.playerZ) > 75) this.agents.pop();
    }
  }

  private pickVehicleSpec(narrowLane: boolean): (typeof FLEET_DISTRIBUTION)[number] {
    let r = this.rng();
    for (let i = 0; i < FLEET_DISTRIBUTION.length; i++) {
      const item = FLEET_DISTRIBUTION[i];
      if (narrowLane && (item.kind === 'bus' || item.kind === 'truck')) continue;
      if (r <= item.weight) {
        // CNGs are less frequent in the quiet hours; existing nearby vehicles
        // are never swapped out merely because the clock ticked.
        if (item.kind === 'cng' && this.quietFactor < 0.75 && this.rng() > this.quietFactor) {
          return FLEET_DISTRIBUTION[0];
        }
        return item;
      }
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
      plannedLaneId: null,
      turnLane: null,
      turnT: 0,
      turnLead: 0,
      turnOffsetX: 0,
      turnOffsetZ: 0,
      potholeDepth: 0,
      bumpOffset: 0,
      contactTravel: 0,
      contactSideTravel: 0,
      contactCooldown: 0,
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

  /**
   * Test/analysis hook (same family as `debugPositionAgentForTest`): hold the
   * entire ambient fleet perfectly still while a deterministic physics/input
   * measurement window runs — recycled agents can otherwise respawn into the
   * measurement corridor mid-window. Never used by shipping gameplay.
   */
  debugSetSimulationFrozen(frozen: boolean): void {
    this.debugSimFrozen = frozen;
  }

  /** Ask an EXISTING roadside van/CNG/bus to pause briefly for loading.
   * Never creates a vehicle, changes its route, or stops one inside a junction.
   * The ordinary braking/headway logic handles the queue and its recovery. */
  scheduleMarketLoading(segmentId: string, x: number, z: number, px: number, pz: number): boolean {
    if (Math.hypot(px - x, pz - z) < 30) return false;
    for (const a of this.agents) {
      if (!a.visible || !a.lane.jamProne || a.lane.segmentId !== segmentId ||
          a.turnLane || a.dwellTimer > 0 || a.dwellCooldown > 0 ||
          a.s < 9 || a.s > a.lane.length - 12 ||
          (a.kind !== 'van' && a.kind !== 'cng' && a.kind !== 'bus') ||
          Math.hypot(a.x - x, a.z - z) > 22) continue;
      a.dwellTimer = a.kind === 'bus' ? 6 : 4.5;
      a.dwellCooldown = 60; // never create a repeating jam at one stop
      a.targetLateral = clamp(a.lane.halfRoadWidth * 0.22, 0.2, 0.9);
      return true;
    }
    return false;
  }

  /**
   * Induce a bounded slow zone / jam near (x, z) — used by the event director's
   * traffic-accident & broken-vehicle zones (vNext §7). Congestion decays
   * exponentially in `update`, so cleanup is guaranteed with no extra calls.
   */
  induceCongestionNear(x: number, z: number, amount = 1.6, radius = 24): void {
    const rSq = radius * radius;
    for (const lane of this.graph.lanes) {
      const mx = (lane.ax + lane.bx) * 0.5;
      const mz = (lane.az + lane.bz) * 0.5;
      if ((mx - x) * (mx - x) + (mz - z) * (mz - z) <= rSq) {
        const prev = this.segmentCongestion.get(lane.segmentId) ?? 1.0;
        this.segmentCongestion.set(lane.segmentId, Math.min(4.8, prev + amount));
      }
    }
  }

  update(dt: number): void {
    if (this.debugSimFrozen) return;
    this.clock += dt;
    this.adjustPopulation(dt);
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
      a.contactCooldown = Math.max(0, a.contactCooldown - dt);
      const dxP = a.x - this.playerX;
      const dzP = a.z - this.playerZ;
      const distSqToPlayer = dxP * dxP + dzP * dzP;
      if (distSqToPlayer > (a.arch.radius + 4) ** 2) a.contactTravel = a.contactSideTravel = 0;

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
            a.wheelSpin += a.speed * dt / a.arch.wheelRadius;
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

      const handling = HANDLING[a.kind];
      let minGap = 999;
      let leaderSpeed = 0;
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
              leaderSpeed = other.speed;
              blockerLateral = other.lateralOffset;
            }
          }
        }
      }

      const distToNode = a.lane.length - a.s;
      if (distToNode < 20 && a.plannedLaneId === null && a.lane.nextLaneIds.length > 0) {
        a.plannedLaneId = this.chooseNextLane(a).id;
      }
      const planned = a.turnLane ?? (a.plannedLaneId ? this.graph.byId.get(a.plannedLaneId) : null);
      // Only a vehicle on our *selected* exit blocks this turn; traffic on
      // unrelated arms of a junction must not produce a phantom stop.
      if (distToNode < 15 && planned) {
        const nextOcc = this.laneOccupancy.get(planned.id);
        if (nextOcc) for (let j = 0; j < nextOcc.length; j++) {
          const other = nextOcc[j];
          if (other !== a && other.s < 12) {
            const netGap = (a.turnLane ? (1 - a.turnT) * a.turnLead * 2 : distToNode) +
              other.s - (other.arch.halfLength + a.arch.halfLength + 0.9);
            if (netGap < minGap) {
              minGap = netGap;
              leaderSpeed = other.speed;
            }
          }
        }
      }

      // Closing velocity, not mere proximity, determines stopping horizon.
      // The signed projection excludes a player behind or in the next lane.
      const playerAlong = this.playerSpeed * Math.cos(this.playerYaw - a.yaw);
      const closing = Math.max(0, a.speed - playerAlong);
      const horizon = Math.min(38, 10 + closing * handling.headway + closing * closing / (2 * handling.brake));
      const playerGap = distSqToPlayer < horizon * horizon
        ? forwardPlayerGap(a.x, a.z, a.yaw, a.arch.halfWidth, a.arch.halfLength, this.playerX, this.playerZ, horizon)
        : null;
      if (playerGap !== null && playerGap < minGap) {
        minGap = playerGap;
        leaderSpeed = playerAlong;
      }

      const redSignal =
        distToNode > 0 &&
        distToNode < 20 &&
        this.isSignalRedForLane(a.lane);
      if (redSignal && !a.turnLane) {
        const stopGap = distToNode - (planned ? junctionLead(a.lane, planned, a.kind) + 0.8 : 3.1);
        if (stopGap < minGap) {
          minGap = stopGap;
          leaderSpeed = 0;
        }
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

      // A short junction reservation for crossing approaches: yield to the
      // vehicle already turning, otherwise the closer approach (stable lane-ID
      // tiebreak). Do not wait for an unrelated arm at a red light.
      if (planned && !a.turnLane && distToNode < 15) {
        const approaches = this.incomingByNode.get(a.lane.toNode);
        if (approaches) for (let k = 0; k < approaches.length; k++) {
          const incoming = approaches[k];
          if (incoming === a.lane) continue;
          const cars = this.laneOccupancy.get(incoming.id)!;
          for (let j = 0; j < cars.length; j++) {
            const other = cars[j];
            const otherDistance = incoming.length - other.s;
            if (otherDistance > 12 || otherDistance < -1 ||
                (!other.turnLane && (other.speed < 0.3 || this.isSignalRedForLane(incoming)))) continue;
            if (other.turnLane || otherDistance + 1 < distToNode ||
                (Math.abs(otherDistance - distToNode) <= 1 && incoming.id < a.lane.id)) {
              minGap = Math.min(minGap, distToNode - junctionLead(a.lane, planned, a.kind) - 0.8);
              leaderSpeed = 0;
            }
          }
        }
      }
      // Do not enter a connector if its chosen exit has no receiving space.
      // Other arms of the same junction do not block this route.
      if (planned && !a.turnLane && distToNode < 15) {
        const exit = this.laneOccupancy.get(planned.id);
        if (exit) for (let j = 0; j < exit.length; j++) {
          const other = exit[j];
          const clearance = junctionLead(a.lane, planned, a.kind) + other.arch.halfLength + a.arch.halfLength + 1;
          if (other.s < clearance) {
            minGap = Math.min(minGap, distToNode - junctionLead(a.lane, planned, a.kind) - 0.8);
            leaderSpeed = 0;
          }
        }
      }
      let desiredSpeed = a.dwellTimer > 0 ? 0 : a.cruise;
      if (a.lane.jamProne) desiredSpeed *= 0.86;
      if (minGap < 28) {
        // Deceleration envelope plus a time headway. A moving leader permits
        // steady following; a stopped leader or oncoming player requires room.
        const room = Math.max(0, minGap - 0.65);
        const safe = Math.sqrt(Math.max(0, leaderSpeed) ** 2 + 2 * handling.brake * room) + Math.min(0, leaderSpeed);
        desiredSpeed = Math.min(desiredSpeed, Math.max(0, safe), Math.max(0, leaderSpeed + room / handling.headway));
      }
      // Commit to a real turn early. A straight option on another exit must
      // not suppress braking for the turn this vehicle actually selected.
      if (planned && a.lane.ux * planned.ux + a.lane.uz * planned.uz < 0.9) {
        const turnSpeed = handling.turn;
        const approach = clamp((distToNode - 5) / 15, 0, 1);
        desiredSpeed = Math.min(desiredSpeed, turnSpeed + (a.cruise - turnSpeed) * approach);
      }
      if (a.turnLane) {
        const tangent = sampleJunction(a.lane, a.turnLane, a.turnLead, a.lateralOffset, a.turnT, this.tmpPt);
        const yawNow = this.tmpPt.yaw;
        const nextT = Math.min(1, a.turnT + 0.025);
        sampleJunction(a.lane, a.turnLane, a.turnLead, a.lateralOffset, nextT, this.tmpPt);
        const bend = Math.abs(angleDelta(yawNow, this.tmpPt.yaw));
        if (bend > 0.001) desiredSpeed = Math.min(desiredSpeed, Math.max(0.8, handling.yaw * tangent * 0.025 / bend * 0.82));
      }
      if (a.lane.nextLaneIds.length === 0 && distToNode < 2) desiredSpeed = 0;

      // Move toward the target with a real m/s² bound. Treating speed error
      // itself as acceleration made cars creep into stopped players forever:
      // when target reached zero, exponential easing still travelled metres.
      const accel = clamp((desiredSpeed - a.speed) / Math.max(stepDt, 1e-4), -handling.brake, handling.accel);
      a.speed = clamp(a.speed + accel * stepDt, 0, a.cruise + 0.8);
      // Travel along the existing lane, then the preselected smooth connector.
      // Never jump from an incorrect exit centreline and spring back afterwards.
      const prevX = a.x, prevZ = a.z;
      if (a.turnLane) {
        const tangent = sampleJunction(a.lane, a.turnLane, a.turnLead, a.lateralOffset, a.turnT, this.tmpPt);
        a.turnT = Math.min(1, a.turnT + a.speed * stepDt / tangent);
      } else {
        a.s += a.speed * stepDt;
        const next = planned ?? (a.s >= a.lane.length - 5 ? this.chooseNextLane(a) : null);
        if (next && next !== a.lane) {
          const lead = junctionLead(a.lane, next, a.kind);
          if (a.s >= a.lane.length - lead && !redSignal && minGap > 0.3) {
            // Carry the tiny overshoot into the connector instead of jumping.
            const over = a.s - (a.lane.length - lead);
            a.turnLane = next;
            a.turnLead = lead;
            a.turnT = Math.min(1, over / Math.max(0.3, lead * 2.55));
            a.turnOffsetX = a.turnOffsetZ = 0;
            a.s = a.lane.length - lead;
          }
        }
        if (!a.turnLane && a.s >= a.lane.length) {
          // Disconnected routes wait here and only relocate well off-screen.
          a.s = a.lane.length - 0.1;
          a.speed = 0;
          a.stuckTimer += stepDt;
          if (a.stuckTimer > 7 && distSqToPlayer > 105 * 105) this.relocateNearPlayer(a);
        }
      }
      if (a.turnLane) {
        sampleJunction(a.lane, a.turnLane, a.turnLead, a.lateralOffset, a.turnT, this.tmpPt);
        a.x = this.tmpPt.x;
        a.z = this.tmpPt.z;
        a.s = a.lane.length - a.turnLead * (1 - a.turnT);
        if (a.turnT >= 1) {
          a.lane = a.turnLane;
          a.s = a.turnLead;
          a.turnLane = null;
          a.turnT = 0;
          a.plannedLaneId = null;
        }
      } else {
        sampleLane(a.lane, a.s, a.lateralOffset, this.tmpPt);
        a.x = this.tmpPt.x;
        a.z = this.tmpPt.z;
      }
      const moved = Math.hypot(a.x - prevX, a.z - prevZ);
      const heading = moved > 0.012 ? Math.atan2(a.x - prevX, a.z - prevZ) : this.tmpPt.yaw;
      const maxYaw = handling.yaw * stepDt;
      a.yaw += clamp(angleDelta(a.yaw, heading), -maxYaw, maxYaw);

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

      if (a.visible) {
        // Only sample heightAt when moving or near bumps; stationary vehicles keep cached ground Y!
        const depth = this.potholeAt(a.x, a.z);
        if (depth > 0.014 && a.potholeDepth <= 0.014) {
          a.bumpOffset = npcPotholeResponse(a.kind, a.speed, depth);
        }
        a.potholeDepth = depth;
        a.bumpOffset *= Math.exp(-stepDt * (a.kind === 'truck' || a.kind === 'bus' ? 5 : 9));
        if (a.speed > 0.05 || a.y === 0 || a.bumpOffset > 0.001) {
          a.y = this.heightAt(a.x, a.z) + a.bumpOffset;
        }
        // Keep the wheel phase continuous across near/far LOD. Far agents
        // already spun on extrapolated frames, so count this frame only once.
        if (a.speed > 0.02) {
          a.wheelSpin += a.speed * (distSqToPlayer > 105 * 105 ? dt : stepDt) / a.arch.wheelRadius;
        }
        a.braking = a.speed < 0.45 || accel < -1.1;
      }
    }

    for (const agent of this.agents) {
      // Visual control follows the agent's real change of heading; it settles
      // to centre on straights and never creates per-frame arm geometry.
      agent.steerAngle = clamp(angleDelta(agent.yaw, agent.lane.yaw) * 0.7, -0.5, 0.5);
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
      const reverse = this.graph.bySegment.get(a.lane.segmentId)?.find(
        (edge) => edge.fromNode === a.lane.toNode && edge.kind !== 'gali',
      );
      return reverse ?? a.lane;
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
        a.plannedLaneId = null;
        a.turnLane = null;
        a.turnOffsetX = a.turnOffsetZ = 0;
        a.potholeDepth = a.bumpOffset = 0;
        a.contactTravel = a.contactSideTravel = a.contactCooldown = 0;
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

  /** A small, lane-aligned nudge at a real player/vehicle contact. Never changes
   * route, target speed, lane choice or AI relevance; heavy vehicles barely move.
   * The impulse is capped per encounter and rejected near junctions/other agents.
   * Returns metres actually moved so callers can distinguish a blocked nudge. */
  nudgeFromPlayer(agentIndex: number, relativeSpeed: number, awayX: number, awayZ: number): number {
    const a = this.agents[agentIndex];
    if (!a || !a.visible || !Number.isFinite(relativeSpeed) || relativeSpeed < 0.8 ||
        a.contactCooldown > 0 || a.roadRageHold > 0 || a.turnLane || a.turnT > 0) return 0;
    const forward = Math.max(0, awayX * a.lane.ux + awayZ * a.lane.uz);
    const side = awayX * a.lane.uz - awayZ * a.lane.ux;
    // Never push an oncoming vehicle backwards along its route. Side contact
    // gets a much smaller lateral displacement that the existing lane tracker
    // damps away; the lane centre and planned turn remain untouched.
    const longitudinal = forward >= 0.22
      ? Math.min(Math.min(0.18, relativeSpeed * 0.035) * CONTACT_RESPONSE[a.kind] * forward,
          1.1 - a.contactTravel, a.lane.length - 2.5 - a.s) : 0;
    const sideLimit = Math.max(0, Math.min(0.24, a.lane.halfRoadWidth * 0.45 - a.arch.halfWidth - 0.12));
    const lateral = Math.abs(side) >= 0.45
      ? clamp(side * relativeSpeed * 0.012 * CONTACT_RESPONSE[a.kind], -0.045, 0.045) : 0;
    const sideStep = clamp(lateral,
      Math.max(-0.24 + a.contactSideTravel, -sideLimit - a.lateralOffset),
      Math.min(0.24 - a.contactSideTravel, sideLimit - a.lateralOffset));
    if (longitudinal <= 0.002 && Math.abs(sideStep) <= 0.002) return 0;
    const nx = a.x + a.lane.ux * longitudinal + a.lane.uz * sideStep;
    const nz = a.z + a.lane.uz * longitudinal - a.lane.ux * sideStep;
    for (let i = 0; i < this.agents.length; i++) {
      const other = this.agents[i];
      if (other === a) continue;
      const dx = other.x - nx, dz = other.z - nz;
      if (dx * dx + dz * dz < (a.arch.halfLength + other.arch.halfLength + 0.35) ** 2) return 0;
    }
    a.s += longitudinal;
    a.lateralOffset += sideStep;
    a.x = nx;
    a.z = nz;
    a.y = this.heightAt(nx, nz);
    a.contactTravel += longitudinal;
    a.contactSideTravel += Math.abs(sideStep);
    a.contactCooldown = 0.065;
    a.bumpOffset = Math.max(a.bumpOffset, Math.min(0.035, Math.hypot(longitudinal, sideStep) * 0.2));
    this.fleet.sync(this.agents);
    return Math.hypot(longitudinal, sideStep);
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
    a.plannedLaneId = null;
    a.turnLane = null;
    a.turnOffsetX = a.turnOffsetZ = 0;
    a.potholeDepth = a.bumpOffset = 0;
    a.contactTravel = a.contactSideTravel = a.contactCooldown = 0;
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

  /**
   * Relocate any ambient vehicle currently overlapping a race starting grid box
   * to a distant lane so all 4 racers start cleanly without spawn collisions.
   */
  clearStartZone(x: number, z: number, radius = 18): void {
    const rSq = radius * radius;
    const totalLanes = this.graph.lanes.length;
    if (totalLanes === 0) return;
    let moved = false;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const dx = a.x - x;
      const dz = a.z - z;
      if (dx * dx + dz * dz > rSq) continue;
      // Pick a lane well away from the start box
      for (let k = 0; k < totalLanes; k++) {
        const cand = this.graph.lanes[(i * 7 + k * 13) % totalLanes];
        const midX = (cand.ax + cand.bx) * 0.5;
        const midZ = (cand.az + cand.bz) * 0.5;
        if ((midX - x) * (midX - x) + (midZ - z) * (midZ - z) > (radius + 38) * (radius + 38)) {
          a.lane = cand;
          a.plannedLaneId = null;
          a.turnLane = null;
          a.s = cand.length * 0.5;
          sampleLane(cand, a.s, 0, this.tmpPt);
          a.x = this.tmpPt.x;
          a.z = this.tmpPt.z;
          a.y = this.heightAt(a.x, a.z);
          a.yaw = this.tmpPt.yaw;
          moved = true;
          break;
        }
      }
    }
    if (moved) this.fleet.sync(this.agents);
  }

  dispose(): void {
    this.agents.length = 0;
    this.group.clear();
  }
}
