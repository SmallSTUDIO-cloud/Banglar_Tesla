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
 */

import * as THREE from 'three';
import type { QualitySettings } from '../core/config';
import { angleDelta, clamp, damp, mulberry32 } from '../core/mathx';
import { SIGNALS } from '../world/layout';
import { getLaneGraph, sampleLane, type LaneEdge, type LaneGraph, type LanePoint } from './routes';
import { buildTrafficMesh, type BuiltTrafficMesh, type TrafficType } from './vehicles';

export type VehicleKind = TrafficType;

export interface TrafficObstacle {
  x: number;
  z: number;
  radius: number;
  kind: VehicleKind;
}

interface ActiveTrafficAgent {
  kind: VehicleKind;
  mesh: BuiltTrafficMesh;
  lane: LaneEdge;
  s: number;
  speed: number;
  cruise: number;
  wheelSpin: number;
  x: number;
  z: number;
  yaw: number;
  lateralOffset: number;
  targetLateral: number;
  dwellTimer: number;
  dwellCooldown: number;
  stuckTimer: number;
  honkTimer: number;
  farAccum: number;
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
  private graph: LaneGraph;
  private agents: ActiveTrafficAgent[] = [];
  private laneOccupancy = new Map<string, ActiveTrafficAgent[]>();
  private segmentCongestion = new Map<string, number>();
  private obstaclePool: TrafficObstacle[] = [];
  private rng = mulberry32(88421);
  private tmpPt: LanePoint = { x: 0, z: 0, yaw: 0 };

  private clock = 0;
  private hornCooldown = 0;
  private playerX = 0;
  private playerZ = 0;
  private heightAt: (x: number, z: number) => number = () => 0.014;

  onHorn?: (x: number, z: number, kind: VehicleKind) => void;

  constructor(quality: QualitySettings, heightAt?: (x: number, z: number) => number) {
    this.group.name = 'mohammadpur-traffic';
    this.graph = getLaneGraph();
    if (heightAt) this.heightAt = heightAt;
    for (const lane of this.graph.lanes) {
      this.laneOccupancy.set(lane.id, []);
    }
    this.setQuality(quality);
  }

  setHeightSampler(fn: (x: number, z: number) => number): void {
    this.heightAt = fn;
  }

  setPlayer(x: number, z: number, _speed: number): void {
    this.playerX = x;
    this.playerZ = z;
  }

  setQuality(quality: QualitySettings): void {
    const target = Math.max(8, quality.trafficCount);
    while (this.agents.length > target) {
      const removed = this.agents.pop()!;
      this.group.remove(removed.mesh.root);
      removed.mesh.brakeMat?.dispose();
    }
    while (this.agents.length < target) {
      this.agents.push(this.spawnAgent(this.agents.length));
    }
  }

  private pickVehicleSpec(narrowLane: boolean): (typeof FLEET_DISTRIBUTION)[number] {
    let r = this.rng();
    for (const item of FLEET_DISTRIBUTION) {
      if (narrowLane && (item.kind === 'bus' || item.kind === 'truck')) continue;
      if (r <= item.weight) return item;
      r -= item.weight;
    }
    return FLEET_DISTRIBUTION[0];
  }

  private pickSpawnLane(preferBusy: boolean): LaneEdge {
    const pool = preferBusy
      ? this.graph.lanes.filter((l) => l.jamProne || l.kind !== 'gali')
      : this.graph.lanes;
    const arr = pool.length > 0 ? pool : this.graph.lanes;
    return arr[Math.floor(this.rng() * arr.length)];
  }

  private spawnAgent(index: number): ActiveTrafficAgent {
    // Concentrate ~65% of initial traffic on busy commercial arteries & nearby streets so jams emerge naturally!
    const lane = this.pickSpawnLane(index % 3 !== 0);
    const spec = this.pickVehicleSpec(lane.kind === 'gali');
    const variant = Math.floor(this.rng() * 4);
    const mesh = buildTrafficMesh(spec.kind, variant);
    const s = this.rng() * Math.max(1, lane.length - 4);
    const lateral =
      spec.kind === 'rickshaw' || spec.kind === 'motorbike'
        ? (this.rng() - 0.5) * 0.65
        : (this.rng() - 0.5) * 0.22;

    sampleLane(lane, s, lateral, this.tmpPt);
    const gy = this.heightAt(this.tmpPt.x, this.tmpPt.z);
    mesh.root.position.set(this.tmpPt.x, gy, this.tmpPt.z);
    mesh.root.rotation.y = this.tmpPt.yaw;
    this.group.add(mesh.root);

    return {
      kind: spec.kind,
      mesh,
      lane,
      s,
      speed: spec.cruiseMin * 0.6,
      cruise: spec.cruiseMin + this.rng() * (spec.cruiseMax - spec.cruiseMin),
      wheelSpin: 0,
      x: this.tmpPt.x,
      z: this.tmpPt.z,
      yaw: this.tmpPt.yaw,
      lateralOffset: lateral,
      targetLateral: lateral,
      dwellTimer: 0,
      dwellCooldown: 5 + this.rng() * 14,
      stuckTimer: 0,
      honkTimer: 1 + this.rng() * 5,
      farAccum: 0,
    };
  }

  private isSignalRedForLane(lane: LaneEdge): boolean {
    if (!lane.toSignal || !lane.signalNodeId) return false;
    for (let i = 0; i < SIGNALS.length; i++) {
      const sig = SIGNALS[i];
      if (sig.nodeId !== lane.signalNodeId) continue;
      const t = (this.clock + sig.offset) % sig.cycle;
      const eastWest = Math.abs(lane.ux) >= Math.abs(lane.uz);
      // 11s green EW, 1s all-clear, 11s green NS, 1s all-clear
      if (eastWest) return t >= 11;
      return t < 12 || t >= 23;
    }
    return false;
  }

  /**
   * Live congestion multiplier (`1.0` = free flow, up to `4.6` = heavy jam)
   * consumed by `findRoute` so route guidance highlights smart detours!
   */
  getCongestionMultiplier(segmentId: string): number {
    return this.segmentCongestion.get(segmentId) ?? 1.0;
  }

  /** List of currently congested segment IDs (`multiplier >= 2.1`) for minimap jam markers. */
  getJammedSegments(): string[] {
    const out: string[] = [];
    for (const [segId, mult] of this.segmentCongestion) {
      if (mult >= 2.1) out.push(segId);
    }
    return out;
  }

  obstacles(): readonly TrafficObstacle[] {
    let n = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (!a.mesh.root.visible) continue;
      const dx = a.x - this.playerX;
      const dz = a.z - this.playerZ;
      if (dx * dx + dz * dz > 26 * 26) continue;
      if (n >= this.obstaclePool.length) {
        this.obstaclePool.push({ x: a.x, z: a.z, radius: a.mesh.radius, kind: a.kind });
      } else {
        const ob = this.obstaclePool[n];
        ob.x = a.x;
        ob.z = a.z;
        ob.radius = a.mesh.radius;
        ob.kind = a.kind;
      }
      n++;
    }
    this.obstaclePool.length = n;
    return this.obstaclePool;
  }

  /** Nearby cycle rickshaws & bikes subtly edge aside when the player rings the bell! */
  reactToBell(px: number, pz: number): void {
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      if (a.kind !== 'rickshaw' && a.kind !== 'motorbike' && a.kind !== 'easybike') continue;
      if (Math.hypot(a.x - px, a.z - pz) < 14) {
        a.targetLateral = clamp(a.lateralOffset + 0.55, -0.8, 0.95);
      }
    }
  }

  update(dt: number): void {
    this.clock += dt;
    this.hornCooldown = Math.max(0, this.hornCooldown - dt);

    // Rebuild per-lane occupancy buckets without allocating new arrays
    for (const bucket of this.laneOccupancy.values()) bucket.length = 0;
    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      this.laneOccupancy.get(a.lane.id)?.push(a);
    }

    // Reset segment congestion accumulators
    this.segmentCongestion.clear();

    for (let i = 0; i < this.agents.length; i++) {
      const a = this.agents[i];
      const distSqToPlayer = (a.x - this.playerX) * (a.x - this.playerX) + (a.z - this.playerZ) * (a.z - this.playerZ);

      // Recycle vehicles that wandered very far (> 235m) onto streets closer (~95..155m) to the player
      // so Mohammadpur streets around the player always feel genuinely alive and jam-capable!
      if (distSqToPlayer > 235 * 235) {
        this.relocateNearPlayer(a);
      }

      const isFar = distSqToPlayer > 140 * 140;
      a.mesh.root.visible = distSqToPlayer < 168 * 168;
      let stepDt = dt;
      if (isFar) {
        a.farAccum += dt;
        if (a.farAccum < 0.066) continue;
        stepDt = a.farAccum;
        a.farAccum = 0;
      }

      // 1. Bus-stop passenger dwell & market-corridor loading stops (root cause of real Dhaka jams!)
      a.dwellCooldown = Math.max(0, a.dwellCooldown - stepDt);
      if (a.dwellTimer > 0) {
        a.dwellTimer = Math.max(0, a.dwellTimer - stepDt);
      } else if (
        a.dwellCooldown <= 0 &&
        a.lane.jamProne &&
        a.s > a.lane.length * 0.28 &&
        a.s < a.lane.length * 0.72 &&
        (a.kind === 'bus' || a.kind === 'cng' || a.kind === 'van')
      ) {
        // Pull slightly toward left curb to board passengers / unload market crates
        a.dwellTimer = a.kind === 'bus' ? 5.2 + this.rng() * 3.2 : 3.0 + this.rng() * 2.5;
        a.dwellCooldown = 22 + this.rng() * 20;
        a.targetLateral = clamp(a.lane.halfRoadWidth * 0.22, 0.2, 0.9);
      }

      // 2. Car-following gap to vehicles ahead on the SAME lane + outgoing junction
      let minGap = 999;
      let blockerLateral = 0;
      const sameLane = this.laneOccupancy.get(a.lane.id)!;
      for (let j = 0; j < sameLane.length; j++) {
        const other = sameLane[j];
        if (other === a) continue;
        const ahead = other.s - a.s;
        if (ahead > 0.05 && ahead < 28) {
          const latSep = Math.abs(other.lateralOffset - a.lateralOffset);
          const minLatClear = (other.mesh.halfWidth + a.mesh.halfWidth) * 0.92;
          if (latSep < minLatClear) {
            const netGap = ahead - (other.mesh.halfLength + a.mesh.halfLength + 0.85);
            if (netGap < minGap) {
              minGap = netGap;
              blockerLateral = other.lateralOffset;
            }
          }
        }
      }

      // Also check vehicles just past the upcoming node on outgoing lanes so intersections don't overlap!
      const distToNode = a.lane.length - a.s;
      if (distToNode < 14 && a.lane.nextLaneIds.length > 0) {
        for (let k = 0; k < a.lane.nextLaneIds.length; k++) {
          const nextOcc = this.laneOccupancy.get(a.lane.nextLaneIds[k]);
          if (!nextOcc) continue;
          for (let j = 0; j < nextOcc.length; j++) {
            const other = nextOcc[j];
            if (other.s < 9) {
              const netGap = distToNode + other.s - (other.mesh.halfLength + a.mesh.halfLength + 0.9);
              if (netGap < minGap) minGap = netGap;
            }
          }
        }
      }

      // 3. Respect player rickshaw in driving lane
      if (distSqToPlayer < 18 * 18) {
        const fx = Math.sin(a.yaw);
        const fz = Math.cos(a.yaw);
        const dx = this.playerX - a.x;
        const dz = this.playerZ - a.z;
        const aheadDot = dx * fx + dz * fz;
        const latDot = Math.abs(dx * fz - dz * fx);
        if (aheadDot > 0.4 && latDot < a.mesh.halfWidth + 1.05) {
          minGap = Math.min(minGap, aheadDot - (a.mesh.halfLength + 1.35));
        }
      }

      // 4. Signalised intersection red light stop line
      const redSignal =
        a.stuckTimer < 8.5 &&
        distToNode > 1.8 &&
        distToNode < 9.5 &&
        this.isSignalRedForLane(a.lane);
      if (redSignal) {
        minGap = Math.min(minGap, distToNode - 2.6);
      }

      // 5. Nimble Dhaka cycle rickshaw / motorbike weaving around stopped buses/cars on wide roads!
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

      // 6. Anti-deadlock guarantee: if completely stalled > 8.5s, allow gentle creep clearance!
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
        // Cooperative deadlock breaker: creep forward slowly so traffic never freezes forever!
        desiredSpeed = Math.max(desiredSpeed, 1.35);
        if (a.stuckTimer > 13.5) a.stuckTimer = 0;
      }

      const accel = clamp(desiredSpeed - a.speed, -6.8, 2.8);
      a.speed = clamp(a.speed + accel * stepDt, 0, a.cruise + 0.8);
      a.s += a.speed * stepDt;

      // Advance smoothly onto next connected Mohammadpur lane at intersection!
      if (a.s >= a.lane.length) {
        const over = a.s - a.lane.length;
        a.lane = this.chooseNextLane(a);
        a.s = Math.min(over, a.lane.length * 0.4);
      }

      // Accumulate live congestion telemetry on this road segment
      if (a.speed < a.cruise * 0.42) {
        const prev = this.segmentCongestion.get(a.lane.segmentId) ?? 1.0;
        this.segmentCongestion.set(a.lane.segmentId, Math.min(4.8, prev + 0.68));
      }

      // Occasional authentic Dhaka traffic horns when queued near player!
      a.honkTimer = Math.max(0, a.honkTimer - stepDt);
      if (minGap < 3.2 && a.dwellTimer <= 0 && a.honkTimer <= 0 && this.hornCooldown <= 0 && distSqToPlayer < 48 * 48) {
        a.honkTimer = 5 + this.rng() * 8;
        this.hornCooldown = 2.1;
        this.onHorn?.(a.x, a.z, a.kind);
      }

      // Update 3D pose, smooth corner yaw, ground elevation & wheel rotation
      sampleLane(a.lane, a.s, a.lateralOffset, this.tmpPt);
      a.x = this.tmpPt.x;
      a.z = this.tmpPt.z;
      a.yaw += angleDelta(a.yaw, this.tmpPt.yaw) * (1 - Math.exp(-9 * stepDt));

      if (a.mesh.root.visible) {
        const gy = this.heightAt(a.x, a.z);
        a.mesh.root.position.set(a.x, gy, a.z);
        a.mesh.root.rotation.y = a.yaw;
        a.wheelSpin += (a.speed * stepDt) / a.mesh.wheelRadius;
        for (let w = 0; w < a.mesh.wheels.length; w++) {
          a.mesh.wheels[w].rotation.x = a.wheelSpin;
        }
        if (a.mesh.brakeMat) {
          a.mesh.brakeMat.emissiveIntensity = a.speed < 0.45 || accel < -1.1 ? 2.1 : 0.25;
        }
      }
    }
  }

  private chooseNextLane(a: ActiveTrafficAgent): LaneEdge {
    const ids = a.lane.nextLaneIds;
    if (ids.length === 0) return a.lane;
    // Heavy buses & trucks avoid narrow `gali` lanes, leaving side lanes open as player jam-bypass routes!
    if (a.kind === 'bus' || a.kind === 'truck') {
      const wide = ids
        .map((id) => this.graph.byId.get(id)!)
        .filter((l) => l && l.kind !== 'gali');
      if (wide.length > 0) return wide[Math.floor(this.rng() * wide.length)];
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
        a.yaw = this.tmpPt.yaw;
        a.stuckTimer = 0;
        return;
      }
    }
  }

  dispose(): void {
    for (const a of this.agents) {
      a.mesh.brakeMat?.dispose();
    }
    this.agents.length = 0;
    this.group.clear();
  }
}
