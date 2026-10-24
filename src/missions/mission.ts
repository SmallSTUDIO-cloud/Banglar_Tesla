/**
 * Mission generation — pure and deterministic given a seeded RNG so the daily
 * challenge is reproducible and tests can rely on it.
 *
 * Uses actual Mohammadpur road-network shortest-path distances (`findRoute`).
 */

import { PLACES, placeById, findRoute, type PlaceDef } from '../world/layout';
import { clamp } from '../core/mathx';
import { computeFare } from '../economy/economy';
import { archetypeById, type Archetype } from './actors';

export type OptionalGoal = 'fast' | 'smooth' | 'lane' | 'rain';
export type MissionKind = 'passenger' | 'market';

export interface MissionOffer {
  id: string;
  kind: MissionKind;
  archetype: Archetype;
  pickupId: string;
  dropId: string;
  pickupName: string;
  dropName: string;
  /** Connected road-network distance in metres. */
  distance: number;
  /** Seconds the rider expects the trip to take. */
  targetTime: number;
  fareEstimate: number;
  optional: OptionalGoal | null;
  daily: boolean;
  multiplier: number;
  seed: number;
}

export interface MissionGenOptions {
  rng: () => number;
  fromPlaceId?: string;
  excludeDropId?: string;
  wet: boolean;
  daily?: boolean;
  minDistance?: number;
  maxDistance?: number;
  seed?: number;
}

/** Connected Mohammadpur road-network distance in metres between two places. */
export function roadDistance(a: PlaceDef, b: PlaceDef): number {
  if (a.id === b.id) return 0;
  return findRoute(a.x, a.z, b.x, b.z).distance;
}

export function generateMission(opts: MissionGenOptions): MissionOffer {
  const { rng } = opts;
  const minDist = opts.minDistance ?? 95;
  const maxDist = opts.maxDistance ?? 680;
  const pickupPool = PLACES.filter((p) => p.kind === 'pickup' || p.kind === 'both');
  const candidates: { pickup: PlaceDef; drop: PlaceDef; distance: number }[] = [];
  for (const pickup of pickupPool) {
    for (const drop of PLACES) {
      if (drop.id === pickup.id) continue;
      if (drop.id === opts.excludeDropId) continue;
      if (opts.fromPlaceId && pickup.id !== opts.fromPlaceId) continue;
      const distance = roadDistance(pickup, drop);
      if (distance < minDist || distance > maxDist) continue;
      candidates.push({ pickup, drop, distance });
    }
  }
  const pool =
    candidates.length > 0
      ? candidates
      : PLACES.filter((p) => p.id !== (opts.fromPlaceId ?? 'stand')).map((drop) => {
          const pk = placeById(opts.fromPlaceId ?? 'stand') ?? PLACES[0];
          return {
            pickup: pk,
            drop,
            distance: roadDistance(pk, drop),
          };
        });
  const choice = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  const archetypes: Archetype[] = ['student', 'office', 'shopper', 'elder', 'tourist', 'singer'];
  const archetype = archetypes[Math.floor(rng() * archetypes.length)];
  const def = archetypeById(archetype);
  const averageSpeed = 4.6;
  const targetTime = clamp(Math.round((choice.distance / averageSpeed) * 1.65 + 16 * def.patience), 28, 280);

  const optionalRoll = rng();
  let optional: OptionalGoal | null = null;
  if (optionalRoll < 0.24) optional = 'fast';
  else if (optionalRoll < 0.46) optional = 'smooth';
  else if (optionalRoll < 0.68) optional = 'lane';
  else if (opts.wet) optional = 'rain';

  const marketOrigin =
    choice.pickup.id === 'bazaar' || choice.pickup.id === 'market' || choice.drop.id === 'bazaar';
  const kind: MissionKind = marketOrigin && rng() < 0.35 ? 'market' : 'passenger';

  const multiplier = opts.daily ? 1.35 : kind === 'market' ? 1.15 : 1;
  const fare = computeFare({
    distance: choice.distance,
    timeTaken: 0,
    targetTime,
    mood: 88,
    damage: 0,
    fareMultiplier: multiplier,
  });

  return {
    id: `m${Math.floor(rng() * 1_000_000)}`,
    kind,
    archetype,
    pickupId: choice.pickup.id,
    dropId: choice.drop.id,
    pickupName: choice.pickup.nameKey,
    dropName: choice.drop.nameKey,
    distance: choice.distance,
    targetTime,
    fareEstimate: fare.total,
    optional,
    daily: opts.daily ?? false,
    multiplier,
    seed: opts.seed ?? Math.floor(rng() * 1e9),
  };
}

/** The offline "challenge of the day": seeded by the local date. */
export function dailySeed(date: Date): number {
  const key = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function dateKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}
