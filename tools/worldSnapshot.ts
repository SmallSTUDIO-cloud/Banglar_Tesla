/**
 * Generated-world snapshot: buildings and other geometry-derived output.
 *
 * The gameplay baseline (`tools/gameplaySnapshot.ts`) pins the road graph and
 * authored gameplay. It does **not** pin the world that is generated *from* that
 * graph, and that is a real gap: `city.ts` walks each segment with
 * `while (along < seg.length - 9.5)`, so changing a segment's length silently
 * changes how many buildings exist and where they sit. Nothing caught that.
 *
 * This module closes the gap. It is deliberately **pure**: it takes the already
 * built `CityResult` and derives counts, per-segment distribution and stable
 * fingerprints. No Three.js, no DOM, so the comparison logic is unit-testable
 * and the fingerprints are reproducible.
 *
 * ## Attribution
 *
 * `buildCity` does not record which segment produced which building, and adding
 * that field would mean editing generation code (out of scope for Phase 0, and a
 * risk to RNG ordering). Instead each building is attributed to the nearest
 * segment centreline by perpendicular distance. That derivation is:
 *   - deterministic (no iteration-order dependence),
 *   - stable under the edits we care about (a moved building changes its
 *     nearest segment only when it genuinely crosses a road),
 *   - tie-broken by segment id so equal distances never reorder.
 *
 * ## Fingerprints
 *
 * A fingerprint contains only stable, ordered data: the attributed segment id
 * and the rounded world position and footprint. There are no timestamps, no
 * indices into an unstable array and no random ordering. Buildings are sorted by
 * `(segmentId, x, z)` before hashing, so the same world always yields the same
 * digest regardless of generation order.
 */

import { ROAD_SEGMENTS } from '../src/world/layout';

/** Rounded to 1 cm at world scale (~2.8 cm real). Fine enough to catch drift. */
const POSITION_PRECISION = 2;

const round = (n: number, d = POSITION_PRECISION): number => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export interface BuildingFingerprint {
  /**
   * Stable identity: `segmentId` plus rounded position.
   *
   * Position-keyed rather than index-keyed on purpose. It lets the diff match
   * buildings across snapshots, so inserting one building does not shift every
   * later record and produce a thousand-line false diff. A *moved* building
   * appears as MISSING + UNEXPECTED (unambiguous); a resized building keeps its
   * id and reports only the changed dimension.
   */
  id: string;
  /** Nearest road segment, used as the stable identity bucket. */
  segmentId: string;
  /** Footprint centre in world units. */
  x: number;
  z: number;
  /** Footprint extent in world units. */
  width: number;
  depth: number;
  height: number;
}

export interface WorldSnapshot {
  counts: {
    buildings: number;
    props: number;
    walls: number;
    trees: number;
    utilityPoles: number;
    lamps: number;
    litter: number;
    infill: number;
    posters: number;
    billboards: number;
    grocery: number;
    speedHumps: number;
  };
  /** Buildings per segment, including zeroes so a shift is visible. */
  buildingsBySegment: Record<string, number>;
  /** Sorted, stable building list. */
  buildings: BuildingFingerprint[];
}

/** The parts of a generated collider this module needs. */
export interface ColliderLike {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  kind: 'building' | 'prop' | 'wall';
  cx?: number;
  cz?: number;
}

/** The parts of `CityResult` this module needs. */
export interface CityLike {
  colliders: readonly ColliderLike[];
  treeCount: number;
  utilityPoleSites: readonly unknown[];
  lampPositions: readonly unknown[];
  litterCount: number;
  infillCount: number;
  posterCount: number;
  billboardCount: number;
  groceryCount: number;
  humps: readonly unknown[];
}

export interface SegmentDistance {
  segmentId: string;
  distance: number;
}

/**
 * Nearest segment centreline to a point, by perpendicular distance.
 * Deterministic: ties resolve to the lexicographically smaller segment id.
 */
export function nearestSegmentId(x: number, z: number): SegmentDistance {
  let best: SegmentDistance | null = null;
  for (const s of ROAD_SEGMENTS) {
    const dx = x - s.ax;
    const dz = z - s.az;
    const along = Math.max(0, Math.min(s.length, dx * s.ux + dz * s.uz));
    const px = s.ax + s.ux * along;
    const pz = s.az + s.uz * along;
    const distance = Math.hypot(x - px, z - pz);
    if (
      best === null ||
      distance < best.distance - 1e-9 ||
      (Math.abs(distance - best.distance) <= 1e-9 && s.id < best.segmentId)
    ) {
      best = { segmentId: s.id, distance };
    }
  }
  // ROAD_SEGMENTS is never empty, but keep the contract honest.
  return best ?? { segmentId: 'unknown', distance: Number.POSITIVE_INFINITY };
}

/** Centre of a collider, preferring the explicit OBB centre when present. */
function colliderCentre(c: ColliderLike): { x: number; z: number } {
  const x = c.cx ?? (c.minX + c.maxX) / 2;
  const z = c.cz ?? (c.minZ + c.maxZ) / 2;
  return { x, z };
}

/**
 * Build the world snapshot from a generated city.
 *
 * Output is a pure function of the input: same `CityResult` in, same JSON out.
 */
export function buildWorldSnapshot(city: CityLike): WorldSnapshot {
  const buildings: BuildingFingerprint[] = [];
  let props = 0;
  let walls = 0;

  for (const c of city.colliders) {
    if (c.kind === 'prop') {
      props++;
      continue;
    }
    if (c.kind === 'wall') {
      walls++;
      continue;
    }
    const { x, z } = colliderCentre(c);
    const segmentId = nearestSegmentId(x, z).segmentId;
    const rx = round(x);
    const rz = round(z);
    buildings.push({
      id: `${segmentId}:${rx.toFixed(2)},${rz.toFixed(2)}`,
      segmentId,
      x: rx,
      z: rz,
      width: round(c.maxX - c.minX),
      depth: round(c.maxZ - c.minZ),
      height: round(c.height),
    });
  }

  // Stable order: segment, then position. Independent of generation order.
  buildings.sort((a, b) => {
    if (a.segmentId !== b.segmentId) return a.segmentId < b.segmentId ? -1 : 1;
    if (a.x !== b.x) return a.x - b.x;
    if (a.z !== b.z) return a.z - b.z;
    if (a.width !== b.width) return a.width - b.width;
    return a.depth - b.depth;
  });

  const buildingsBySegment: Record<string, number> = {};
  for (const s of ROAD_SEGMENTS) buildingsBySegment[s.id] = 0;
  for (const b of buildings) buildingsBySegment[b.segmentId] = (buildingsBySegment[b.segmentId] ?? 0) + 1;

  return {
    counts: {
      buildings: buildings.length,
      props,
      walls,
      trees: city.treeCount,
      utilityPoles: city.utilityPoleSites.length,
      lamps: city.lampPositions.length,
      litter: city.litterCount,
      infill: city.infillCount,
      posters: city.posterCount,
      billboards: city.billboardCount,
      grocery: city.groceryCount,
      speedHumps: city.humps.length,
    },
    buildingsBySegment,
    buildings,
  };
}

/**
 * Full fingerprint including footprint. The `id` covers identity (segment +
 * position); this adds the dimensions so the digest also changes when a building
 * is resized in place.
 */
export function fingerprintOf(b: BuildingFingerprint): string {
  return `${b.id},${b.width.toFixed(2)}x${b.depth.toFixed(2)}x${b.height.toFixed(2)}`;
}

/**
 * Order-independent digest over the whole building set.
 *
 * FNV-1a over the sorted fingerprint list. A single moved building, a changed
 * footprint, a changed count or a building attributed to a different segment all
 * change the digest.
 */
export function worldDigest(snapshot: WorldSnapshot): string {
  const payload = snapshot.buildings.map(fingerprintOf).join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
