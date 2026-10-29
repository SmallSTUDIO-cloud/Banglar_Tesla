/** One-shot roadside fare bargaining and valid sidewalk placement. */
import type { PedPath } from '../ai/pedestrians';
import { isInsideDrmcCampus } from '../world/drmcGeo';
import { isClearOfRoads, segmentById } from '../world/layout';

export type NegotiationResult = 'accepted' | 'rejected' | 'already-attempted';

/** A roll every ten eligible seconds: ~33 seconds mean before a call, in
 * addition to the post-request cooldown. Kept injectable for exact tests. */
export function shouldCallForRide(rng: () => number = Math.random): boolean {
  return rng() < 0.3;
}

/** A waiting point cannot immediately produce another apparently identical
 * caller, in addition to the separate crowd-identity cooldown. */
export function roadsideStopKey(stop: RoadsideStop): string {
  return `${stop.pickup.segmentId}:${Math.round(stop.actor.x * 2)}:${Math.round(stop.actor.z * 2)}`;
}

export class FareNegotiation {
  attempted = false;
  fare: number;
  constructor(initialFare: number) {
    this.fare = Math.max(1, Math.round(initialFare));
  }
  /** One independent 50% roll; failure cancels rather than allowing rerolls. */
  attempt(rng: () => number = Math.random): NegotiationResult {
    if (this.attempted) return 'already-attempted';
    this.attempted = true;
    if (rng() >= 0.5) return 'rejected';
    this.fare = Math.max(this.fare + 1, Math.round(this.fare * 1.2));
    return 'accepted';
  }
}

export interface RoadsideStop {
  actor: { x: number; z: number; yaw: number };
  pickup: { x: number; z: number; segmentId: string };
  /** A short walk along the same validated sidewalk, away from the player. */
  departure: { x: number; z: number };
}

/** Find the nearest pedestrian-safe position on an already validated sidewalk.
 * Sampling also excludes junction mouths and the private campus boundary. */
export function nearestSafeSidewalk(paths: readonly PedPath[], x: number, z: number): { x: number; z: number; yaw: number } | null {
  let best: { x: number; z: number; yaw: number } | null = null;
  let bestDistance = Infinity;
  for (const path of paths) {
    const steps = Math.max(1, Math.ceil(path.length / 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sx = path.ax + (path.bx - path.ax) * t, sz = path.az + (path.bz - path.az) * t;
      const d = Math.hypot(sx - x, sz - z);
      if (d >= bestDistance || isInsideDrmcCampus(sx, sz, 1.6) || !isClearOfRoads(sx, sz, 0.15)) continue;
      bestDistance = d;
      best = { x: sx, z: sz, yaw: Math.atan2(x - sx, z - sz) };
    }
  }
  return best;
}

/** Select a visible nearby sidewalk and its adjacent stopping lane. */
export function chooseRoadsideStop(paths: readonly PedPath[], px: number, pz: number, yaw: number, rng: () => number = Math.random, isClear: (stop: RoadsideStop) => boolean = () => true): RoadsideStop | null {
  const candidates: Array<{ stop: RoadsideStop; facing: number }> = [];
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  for (const path of paths) {
    const seg = segmentById(path.segmentId);
    if (!seg) continue;
    for (const t of [0.12, 0.3, 0.5, 0.7, 0.88]) {
      const x = path.ax + (path.bx - path.ax) * t;
      const z = path.az + (path.bz - path.az) * t;
      const distance = Math.hypot(x - px, z - pz);
      if (distance < 10 || distance > 35 || isInsideDrmcCampus(x, z, 2)) continue;
      const along = (x - seg.ax) * seg.ux + (z - seg.az) * seg.uz;
      const centerX = seg.ax + seg.ux * along;
      const centerZ = seg.az + seg.uz * along;
      const side = Math.sign((x - centerX) * seg.leftX + (z - centerZ) * seg.leftZ) || 1;
      const pickup = { x: centerX + seg.leftX * seg.halfWidth * 0.5 * side, z: centerZ + seg.leftZ * seg.halfWidth * 0.5 * side, segmentId: seg.id };
      if (isInsideDrmcCampus(pickup.x, pickup.z, 1.5)) continue;
      const span = Math.hypot(path.bx - path.ax, path.bz - path.az);
      const delta = Math.min(4 / span, 0.35);
      const t1 = Math.max(0, t - delta), t2 = Math.min(1, t + delta);
      const x1 = path.ax + (path.bx - path.ax) * t1, z1 = path.az + (path.bz - path.az) * t1;
      const x2 = path.ax + (path.bx - path.ax) * t2, z2 = path.az + (path.bz - path.az) * t2;
      const departure = Math.hypot(x1 - px, z1 - pz) > Math.hypot(x2 - px, z2 - pz) ? { x: x1, z: z1 } : { x: x2, z: z2 };
      const stop = { actor: { x, z, yaw: Math.atan2(pickup.x - x, pickup.z - z) }, pickup, departure };
      if (!isClear(stop)) continue;
      candidates.push({
        stop,
        facing: ((x - px) * fx + (z - pz) * fz) / distance,
      });
    }
  }
  const forward = candidates.filter((c) => c.facing > -0.1);
  const pool = forward.length ? forward : candidates;
  return pool.length ? pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))].stop : null;
}
