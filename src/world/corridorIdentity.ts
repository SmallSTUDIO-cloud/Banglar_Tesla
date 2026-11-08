/**
 * Ring Road and Tajmahal Road corridor character (v0.7.0).
 *
 * The two corridors previously read as generic Mohammadpur: the same 2-6 storey
 * plaster blocks on both sides with generic shopfront signage, and no trace of
 * the institutions that actually line them. This module supplies the
 * *identity* layer only — landmark structures, corridor signboards and
 * corridor-specific street activity.
 *
 * Design constraints, deliberate:
 *  - Pure data + pure maths, no Three.js, so it is unit-testable.
 *  - Every coordinate descends from a verified OSM feature in `landmarks.ts`;
 *    nothing here invents a place.
 *  - Structures are merged into the existing per-sector geometry buckets by the
 *    caller (`city.ts`), so the corridor work adds **no draw calls** and no new
 *    material or geometry family. This matters for Android.
 *
 * Stylised low-poly only: flat boxes, a dome cone, a mihrab arch, low walls.
 * No new textures, no shadows casters, no post-processing.
 */

import { LANDMARKS, landmarkById, type Landmark } from './landmarks';
import {
  ROAD_SEGMENTS,
  distanceToRoadCorridor,
  isFootprintClearOfCorridor,
  segmentById,
} from './layout';

export type CorridorId = 'ring' | 'tajmahal';

export interface CorridorSpec {
  id: CorridorId;
  nameEn: string;
  nameBn: string;
  /** Signage key used by the sign atlas. */
  signId: string;
  /** Segments that make up the corridor, west-to-east / south-to-north. */
  segmentIds: readonly string[];
  /**
   * What makes this corridor locally distinct, in one line. Used for docs and
   * asserted by tests so the character cannot silently drift into generic.
   */
  character: string;
}

export const CORRIDORS: readonly CorridorSpec[] = [
  {
    id: 'ring',
    nameEn: 'Ring Road',
    nameBn: 'রিং রোড',
    signId: 'ring_road',
    segmentIds: ['ring_1', 'ring_2', 'ring_3', 'ring_4'],
    character:
      'Wide arterial with civic and commercial frontage: the Shia Jame Masjid, Tokyo Square and Queen\'s College all front it.',
  },
  {
    id: 'tajmahal',
    nameEn: 'Tajmahal Road',
    nameBn: 'তাজমহল রোড',
    signId: 'tajmahal_road',
    segmentIds: ['tajmahal_1', 'tajmahal_2', 'tajmahal_3', 'tajmahal_4', 'tajmahal_5'],
    character:
      'Quieter residential spine that opens onto the Mohammadpur graveyard and Eidgah ground at its eastern end.',
  },
];

/** Which corridor a landmark belongs to, if any. */
export function corridorOfLandmark(landmarkId: string): CorridorId | null {
  for (const corridor of CORRIDORS) {
    const landmark = landmarkById(landmarkId);
    if (landmark && landmark.frontageSegmentId &&
        corridor.segmentIds.includes(landmark.frontageSegmentId)) {
      return corridor.id;
    }
  }
  return null;
}

/* ------------------------------------------------------------ structures */

export type StructureKind = 'mosque' | 'commercial' | 'college' | 'grave-yard' | 'eidgah';

export interface StructureSpec {
  /** Landmark this structure represents; coordinates come from the registry. */
  landmarkId: string;
  corridor: CorridorId;
  kind: StructureKind;
  /** Footprint half-extents in metres, used for corridor clearance validation. */
  halfX: number;
  halfZ: number;
  /** Rotation about Y, radians. */
  yaw: number;
  /** Body colour and accent (dome / signage band / roof), stylised plaster hues. */
  body: string;
  accent: string;
}

/**
 * Landmark structures to build. Half-extents are deliberately modest and are
 * validated against the road corridor before anything is placed — an OSM
 * centogram can sit only ~7 m from the carriageway, so a full-footprint replica
 * would bury the road.
 */
export const CORRIDOR_STRUCTURES: readonly StructureSpec[] = [
  {
    landmarkId: 'shia_jame_masjid',
    corridor: 'ring',
    kind: 'mosque',
    // The OSM parcel is 14.5 x 20.0 m, but its western third overlaps what this
    // world models as the Ring Road carriageway + sidewalk, and krishi_cut_s
    // crosses the same block. Only a narrow strip of the parcel is buildable, so
    // the mosque is a compact 5 x 7.2 m neighbourhood mass seated on that strip.
    // Building it any larger would mean building into a traffic lane.
    halfX: 2.5,
    halfZ: 3.6,
    yaw: 0,
    body: '#f3efe4',
    accent: '#1e7b5a',
  },
  {
    landmarkId: 'tokyo_square',
    corridor: 'ring',
    kind: 'commercial',
    halfX: 7.2,
    halfZ: 5.4,
    yaw: 0.35,
    body: '#e8e2d4',
    accent: '#b8543f',
  },
  {
    landmarkId: 'queens_college',
    corridor: 'ring',
    kind: 'college',
    halfX: 8.4,
    halfZ: 5.0,
    yaw: -0.2,
    body: '#e3e6e1',
    accent: '#3f6b8a',
  },
  {
    landmarkId: 'mohammadpur_graveyard',
    corridor: 'tajmahal',
    kind: 'grave-yard',
    halfX: 7.0,
    halfZ: 5.2,
    yaw: 0,
    body: '#cfc9bb',
    accent: '#8f9a8a',
  },
  {
    landmarkId: 'mohammadpur_eidgah',
    corridor: 'tajmahal',
    kind: 'eidgah',
    halfX: 7.6,
    halfZ: 5.4,
    yaw: 0,
    body: '#d6d0c2',
    accent: '#7d8a79',
  },
];

export interface PlacedStructure extends StructureSpec {
  x: number;
  z: number;
  /**
   * How far the built footprint centre was moved outward from the OSM centroid,
   * in metres. Non-zero because an OSM polygon centroid frequently falls inside
   * the road corridor (sidewalk included); the building is placed on its plot
   * behind the frontage and the displacement is reported rather than hidden.
   */
  offsetFromOsm: number;
}

/** Target clearance between a finished footprint and the outer road corridor. */
export const STRUCTURE_CORRIDOR_GAP = 0.9;
/** Refuse to displace a structure further than this from its OSM centroid. */
export const MAX_STRUCTURE_OFFSET = 22;

/**
 * Resolve structures to game coordinates.
 *
 * Each structure keeps its verified OSM `along`-road position and road side, and
 * is then walked outward from the frontage in small steps until its whole
 * footprint clears every road corridor. A closed-form offset is not enough: a
 * parcel can be bounded by a second road (the Shia Jame Masjid parcel is only
 * ~8 m from `krishi_cut_s` as well as Ring Road), so the only reliable test is
 * the same `isFootprintClearOfCorridor` the building system uses.
 *
 * Structures that cannot be seated within `MAX_STRUCTURE_OFFSET` are dropped,
 * never forced into the carriageway; `structureAudit` reports both outcomes.
 */
/**
 * Predicate for "something is already built here". The city builder supplies
 * this so a landmark structure is never seated on top of an existing building;
 * tests can omit it to reason about road geometry alone.
 */
export type OccupancyTest = (
  x: number,
  z: number,
  halfX: number,
  halfZ: number,
  yaw: number,
) => boolean;

export function planCorridorStructures(occupied?: OccupancyTest): PlacedStructure[] {
  const placed: PlacedStructure[] = [];
  for (const spec of CORRIDOR_STRUCTURES) {
    const landmark = landmarkById(spec.landmarkId);
    if (!landmark?.frontageSegmentId) continue;
    // Real, but outside the playable extent: nothing is built into the void.
    if (landmark.outsideWorld) continue;
    const seg = segmentById(landmark.frontageSegmentId);
    if (!seg) continue;
    const side = landmark.frontageSide ?? 1;

    // Keep the along-road position of the real feature.
    const dx = landmark.x - seg.ax;
    const dz = landmark.z - seg.az;
    const along = Math.max(0, Math.min(seg.length, dx * seg.ux + dz * seg.uz));

    // Search a small 2D window around the real feature: along the frontage and
    // across it. A one-dimensional outward walk is not sufficient because a
    // parcel can be pinched between two roads (the Shia Jame Masjid parcel sits
    // between Ring Road and `krishi_cut_s`, leaving ~1 m of clear land at that
    // exact station), while the same parcel is wide enough a few metres along.
    // The seat closest to the OSM centroid wins, so identity is preserved.
    const edge = seg.halfWidth + seg.sidewalk + STRUCTURE_CORRIDOR_GAP;
    let best: { x: number; z: number; offset: number } | null = null;
    for (let shift = -14; shift <= 14; shift += 1) {
      const t = Math.max(2, Math.min(seg.length - 2, along + shift));
      const cx = seg.ax + seg.ux * t;
      const cz = seg.az + seg.uz * t;
      for (let delta = 0; delta <= MAX_STRUCTURE_OFFSET; delta += 0.5) {
        const lateral = (edge + delta) * side;
        const x = cx + seg.leftX * lateral;
        const z = cz + seg.leftZ * lateral;
        if (
          !isFootprintClearOfCorridor(
            x,
            z,
            spec.halfX * 2,
            spec.halfZ * 2,
            spec.yaw,
            STRUCTURE_CORRIDOR_GAP,
          )
        ) {
          continue;
        }
        // Never seat a landmark on top of an existing building.
        if (occupied && occupied(x, z, spec.halfX, spec.halfZ, spec.yaw)) continue;
        const offset = Math.hypot(x - landmark.x, z - landmark.z);
        if (offset > MAX_STRUCTURE_OFFSET) continue;
        if (!best || offset < best.offset) best = { x, z, offset };
      }
    }
    if (best) {
      placed.push({ ...spec, x: best.x, z: best.z, offsetFromOsm: best.offset });
    }
  }
  return placed;
}

export interface StructureAuditRow {
  landmarkId: string;
  placed: boolean;
  /** Signed distance from the OSM centroid to the outer road corridor. */
  corridorGapAtCentroid: number;
  /** Distance from the OSM centroid to the nearest carriageway centreline. */
  roadCentreDistance: number;
  /** Displacement of the built footprint from the OSM centroid (0 if not built). */
  offsetFromOsm: number;
}

/** Per-structure placement audit, for tests and for reporting to the user. */
export function structureAudit(occupied?: OccupancyTest): StructureAuditRow[] {
  const placedById = new Map(planCorridorStructures(occupied).map((p) => [p.landmarkId, p]));
  return CORRIDOR_STRUCTURES.map((spec) => {
    const landmark = landmarkById(spec.landmarkId)!;
    const placed = placedById.get(spec.landmarkId);
    return {
      landmarkId: spec.landmarkId,
      placed: Boolean(placed),
      corridorGapAtCentroid: distanceToRoadCorridor(landmark.x, landmark.z),
      roadCentreDistance: distanceToSegmentCentreline(
        landmark.x,
        landmark.z,
        landmark.frontageSegmentId ?? '',
      ),
      offsetFromOsm: placed ? placed.offsetFromOsm : 0,
    };
  });
}

function distanceToSegmentCentreline(x: number, z: number, segmentId: string): number {
  const s = segmentById(segmentId) ?? ROAD_SEGMENTS[0];
  const dx = x - s.ax;
  const dz = z - s.az;
  const t = Math.max(0, Math.min(s.length, dx * s.ux + dz * s.uz));
  return Math.hypot(x - (s.ax + s.ux * t), z - (s.az + s.uz * t));
}

/* ---------------------------------------------------------------- boards */

export interface CorridorSignPlan {
  corridor: CorridorId;
  signId: string;
  x: number;
  z: number;
  yaw: number;
  dirX: number;
  dirZ: number;
}

/**
 * One corridor name-board on each corridor, mounted on the sidewalk at the
 * midpoint of its longest constituent segment. Kept off the carriageway by
 * construction: it sits `halfWidth + sidewalk * 0.62` from the centreline.
 */
export function planCorridorSignage(): CorridorSignPlan[] {
  const plan: CorridorSignPlan[] = [];
  for (const corridor of CORRIDORS) {
    let best: { seg: (typeof ROAD_SEGMENTS)[number] } | null = null;
    for (const id of corridor.segmentIds) {
      const seg = segmentById(id);
      if (!seg) continue;
      if (!best || seg.length > best.seg.length) best = { seg };
    }
    if (!best) continue;
    const s = best.seg;
    const along = s.length * 0.5;
    const side = 1;
    const apron = s.halfWidth + s.sidewalk * 0.62;
    plan.push({
      corridor: corridor.id,
      signId: corridor.signId,
      x: s.ax + s.ux * along + s.leftX * apron * side,
      z: s.az + s.uz * along + s.leftZ * apron * side,
      yaw: Math.atan2(-s.leftX * side, -s.leftZ * side),
      dirX: s.ux,
      dirZ: s.uz,
    });
  }
  return plan;
}

/* ------------------------------------------------------ street activity */

export interface CorridorActivityPlan {
  corridor: CorridorId;
  kind: 'tea' | 'fuchka' | 'jhalmuri' | 'veg';
  x: number;
  z: number;
  yaw: number;
}

/** Minimum asphalt clearance for a corridor vendor cart. */
export const CORRIDOR_MIN_CLEARANCE = 1.2;

/**
 * Corridor-specific street activity, anchored on the landmark each corridor is
 * known for rather than scattered at random:
 *  - Ring Road: tea and snack carts serving college and mosque traffic.
 *  - Tajmahal Road: flower and produce sellers at the graveyard / Eidgah end.
 */
const ACTIVITY_ANCHORS: Array<{
  landmarkId: string;
  corridor: CorridorId;
  kinds: ReadonlyArray<CorridorActivityPlan['kind']>;
}> = [
  {
    landmarkId: 'queens_college',
    corridor: 'ring',
    kinds: ['tea', 'jhalmuri', 'tea'],
  },
  {
    landmarkId: 'shia_jame_masjid',
    corridor: 'ring',
    kinds: ['fuchka', 'tea'],
  },
  {
    landmarkId: 'mohammadpur_graveyard',
    corridor: 'tajmahal',
    kinds: ['veg', 'veg', 'tea'],
  },
];

export function planCorridorActivity(): CorridorActivityPlan[] {
  const plan: CorridorActivityPlan[] = [];
  for (const anchor of ACTIVITY_ANCHORS) {
    const landmark = landmarkById(anchor.landmarkId);
    if (!landmark || landmark.outsideWorld) continue;
    const s = segmentById(landmark.frontageSegmentId ?? '') ?? ROAD_SEGMENTS[0];
    const side = landmark.frontageSide ?? 1;
    const apron = s.halfWidth + s.sidewalk * 0.62;
    const yaw = Math.atan2(-s.leftX * side, -s.leftZ * side);
    // Walk along the frontage from the landmark, spreading carts out.
    const base = landmark;
    const along0 = (base.x - s.ax) * s.ux + (base.z - s.az) * s.uz;
    for (let i = 0; i < anchor.kinds.length; i++) {
      const t = Math.max(
        2,
        Math.min(s.length - 2, along0 + (i - (anchor.kinds.length - 1) / 2) * 3.4),
      );
      const x = s.ax + s.ux * t + s.leftX * apron * side;
      const z = s.az + s.uz * t + s.leftZ * apron * side;
      // Reject anything that would end up on the asphalt.
      if (distanceToRoadCorridor(x, z) < -(s.sidewalk - CORRIDOR_MIN_CLEARANCE)) continue;
      plan.push({ corridor: anchor.corridor, kind: anchor.kinds[i], x, z, yaw });
    }
  }
  return plan;
}

/** All landmarks used by this module, for provenance tests. */
export function corridorLandmarks(): Landmark[] {
  return CORRIDOR_STRUCTURES.map((s) => landmarkById(s.landmarkId)).filter(
    (l): l is Landmark => Boolean(l),
  );
}

/** Landmarks in the registry that belong to a named corridor. */
export function landmarksOnCorridors(): Landmark[] {
  return LANDMARKS.filter((l) => corridorOfLandmark(l.id) !== null);
}
