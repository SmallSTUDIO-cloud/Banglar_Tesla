/**
 * Mission generation — pure and deterministic given a seeded RNG so the daily
 * challenge is reproducible and tests can rely on it.
 */

import { PLACES, placeById, type PlaceDef } from '../world/layout';
import { clamp } from '../core/mathx';
import { computeFare } from '../economy/economy';
import { archetypeById, type Archetype } from './actors';

export type OptionalGoal = 'fast' | 'smooth' | 'lane' | 'rain';

export interface MissionOffer {
  id: string;
  archetype: Archetype;
  pickupId: string;
  dropId: string;
  pickupName: string;
  dropName: string;
  /** Approximate road distance in metres (used for the fare estimate). */
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

/** Cheap road-ish distance: Manhattan along the grid, scaled by a detour factor. */
export function roadDistance(a: PlaceDef, b: PlaceDef): number {
  const manhattan = Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
  const euclid = Math.hypot(a.x - b.x, a.z - b.z);
  return Math.round(euclid * 1.12 + manhattan * 0.22 + 24);
}

export function generateMission(opts: MissionGenOptions): MissionOffer {
  const { rng } = opts;
  const minDist = opts.minDistance ?? 90;
  const maxDist = opts.maxDistance ?? 420;
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
  // Deterministic fallback if the filter is too tight.
  const pool =
    candidates.length > 0
      ? candidates
      : PLACES.filter((p) => p.id !== opts.fromPlaceId).map((drop) => ({
          pickup: placeById(opts.fromPlaceId ?? 'stand') ?? PLACES[0],
          drop,
          distance: roadDistance(placeById(opts.fromPlaceId ?? 'stand') ?? PLACES[0], drop),
        }));
  const choice = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  const archetypes: Archetype[] = ['student', 'office', 'shopper', 'elder', 'tourist', 'singer'];
  const archetype = archetypes[Math.floor(rng() * archetypes.length)];
  const def = archetypeById(archetype);
  const averageSpeed = 4.1;
  const targetTime = clamp(Math.round(choice.distance / averageSpeed * 1.65 + 14 * def.patience), 26, 240);

  const optionalRoll = rng();
  let optional: OptionalGoal | null = null;
  if (optionalRoll < 0.22) optional = 'fast';
  else if (optionalRoll < 0.42) optional = 'smooth';
  else if (optionalRoll < 0.55) optional = 'lane';
  else if (opts.wet) optional = 'rain';

  const multiplier = opts.daily ? 1.35 : 1;
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
