/**
 * Eviction audit engine.
 *
 * Answers, for every building that disappears when a synthetic road is inserted
 * into the shipped world: *why* did it disappear? Three mechanisms are possible
 * in `buildCity()`:
 *
 *   1. the road's carriageway physically covers the footprint;
 *   2. the generator's corridor rule (carriageway + sidewalk + 0.55 m setback)
 *      refuses it even though the asphalt does not overlap;
 *   3. the frontage walk on the building's own road took a different branch
 *      after some earlier rejection, so the rest of that frontage re-rolled
 *      (`along += 4.5` on failure vs `along += bWidth + gap` on success, and a
 *      failure consumes 3 RNG draws where a success consumes ~15).
 *
 * None of these is inferred from a count: each building is measured against the
 * actual geometry, with the engine's own predicate
 * (`isFootprintClearOfCorridor`) cross-checked against an independent
 * analytic OBB-vs-stadium test written here.
 *
 * This module is diagnostic only. It mutates the live `ROAD_SEGMENTS` array,
 * rebuilds the spatial index, and restores both.
 */

import {
  ROAD_SEGMENTS,
  isFootprintClearOfCorridor,
  rebuildRoadSpatialIndex,
  type RoadSegment,
} from '../../src/world/layout';
import { buildWorldSnapshot, type WorldSnapshot } from '../../tools/worldSnapshot';
import { SYNTHETIC_ROAD } from './syntheticRoad';

export type EvictionClass =
  | 'carriageway-overlap'
  | 'corridor-clearance'
  | 'frontage-reroll'
  | 'unexplained';

export interface Footprint {
  x: number;
  z: number;
  width: number;
  depth: number;
  yaw: number;
  height: number;
}

/** Exact OBB-vs-road-stadium test, independent of the engine's implementation. */
export interface StadiumOverlap {
  overlaps: boolean;
  /** How deep the footprint intrudes into the band, in metres (0 when clear). */
  depth: number;
  /** Lateral signed distance from the centreline to the nearest footprint point. */
  lateralClearance: number;
}

/**
 * The corridor queries project onto a clamped polyline, which makes the road a
 * *stadium*: the rectangle `[0, length] x [-halfWidth, +halfWidth]` plus a
 * half-disc of radius `halfWidth` at each end. The footprint is an oriented box.
 */
export function obbVsStadium(
  fp: Footprint,
  seg: RoadSegment,
  band: number,
): StadiumOverlap {
  const dx = fp.x - seg.ax;
  const dz = fp.z - seg.az;
  // Road-local frame: u along the centreline, v lateral (left positive).
  const u = dx * seg.ux + dz * seg.uz;
  const v = dx * seg.leftX + dz * seg.leftZ;
  const c = Math.cos(fp.yaw);
  const s = Math.sin(fp.yaw);
  // Footprint axes expressed in the road frame (axis1 = local X, axis2 = local Z).
  const e1u = c * seg.ux + s * seg.uz;
  const e1v = c * seg.leftX + s * seg.leftZ;
  const e2u = -s * seg.ux + c * seg.uz;
  const e2v = -s * seg.leftX + c * seg.leftZ;
  const hx = fp.width / 2;
  const hz = fp.depth / 2;
  const radiusU = Math.abs(e1u) * hx + Math.abs(e2u) * hz;
  const radiusV = Math.abs(e1v) * hx + Math.abs(e2v) * hz;

  // --- rectangle part: interval overlap on both axes
  const uMin = 0;
  const uMax = seg.length;
  const overlapU = Math.min(u + radiusU, uMax) - Math.max(u - radiusU, uMin);
  const overlapV = Math.min(v + radiusV, band) - Math.max(v - radiusV, -band);
  if (overlapU > 0 && overlapV > 0) {
    return { overlaps: true, depth: Math.min(overlapU, overlapV), lateralClearance: Math.abs(v) - radiusV - band };
  }

  // --- end caps: nearest endpoint disc vs the box
  let best = Infinity;
  for (const end of [{ u: 0, v: 0 }, { u: seg.length, v: 0 }]) {
    const du = u - end.u;
    const dv = v - end.v;
    // Closest point on the box to the cap centre, in road frame.
    const cu = Math.max(-radiusU, Math.min(radiusU, du));
    const cv = Math.max(-radiusV, Math.min(radiusV, dv));
    const d = Math.hypot(du - cu, dv - cv);
    if (d < best) best = d;
  }
  // Signed lateral clearance uses the full footprint extent, not its centre.
  const lateral = Math.abs(v) - radiusV - band;
  return { overlaps: best < band, depth: best < band ? band - best : 0, lateralClearance: lateral };
}

/** Distance from a point to a segment's clamped centreline. */
export function centrelineDistance(x: number, z: number, seg: RoadSegment): number {
  const t = Math.max(0, Math.min(seg.length, (x - seg.ax) * seg.ux + (z - seg.az) * seg.uz));
  return Math.hypot(x - (seg.ax + seg.ux * t), z - (seg.az + seg.uz * t));
}

/** Signed distance along the segment, and lateral offset (left positive). */
export function segLocal(x: number, z: number, seg: RoadSegment): { u: number; v: number } {
  const dx = x - seg.ax;
  const dz = z - seg.az;
  return { u: dx * seg.ux + dz * seg.uz, v: dx * seg.leftX + dz * seg.leftZ };
}

export interface BaseBuilding extends Footprint {
  key: string;
  id: string;
  segmentId: string;
  /** Nearest *legacy* segment and which side of it the building stands on. */
  frontSegment: string;
  frontSide: 1 | -1;
  frontU: number;
}

export interface EvictionRow {
  key: string;
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  yaw: number;
  /** Nearest road in the shipped graph (the snapshot's own attribution). */
  baseSegment: string;
  /** Nearest legacy road in the shipped graph: the frontage this building lined. */
  frontSegment: string;
  frontSide: 1 | -1;
  /** Distance along that frontage, from its start (metres). */
  frontU: number;
  /** Nearest road once the synthetic road exists. */
  nearestAfter: string;
  distanceToCentreline: number;
  /** centreline - 4.5: negative means the footprint centre is inside the asphalt. */
  clearCentreAsphalt: number;
  /** centreline - 6.0: negative means inside carriageway + sidewalk. */
  clearCentreCorridor: number;
  /** Independent analytic intrusion depth into the asphalt (0 = no overlap). */
  asphaltOverlapDepth: number;
  /** Independent analytic signed lateral clearance of the whole footprint. */
  asphaltLateralClearance: number;
  /** The engine's own predicate on the rebuilt index (true = the generator allows it). */
  engineAllows: boolean;
  /** Engine verdict with the setback dropped, isolating asphalt/sidewalk intrusion. */
  engineAllowsNoSetback: boolean;
  cls: EvictionClass;
  /** For frontage-reroll: the building on the same frontage whose rejection caused it. */
  causedBy?: string;
  /** How many perturbed buildings landed within 15 m along the same frontage. */
  replacements: number;
  replacementHeights: string[];
}

export interface AuditResult {
  baseCampaign: { buildings: number; digest: string };
  perturbed: { buildings: number; digest: string };
  evicted: number;
  added: number;
  /** Base building colliders with no oriented footprint that also vanished. */
  untracedEvicted: number;
  rows: EvictionRow[];
  counts: Record<EvictionClass, number>;
  /** Frontages (segment + side) that took any eviction, with their direct conflicts. */
  frontages: Array<{
    segmentId: string;
    side: 1 | -1;
    evicted: number;
    directConflicts: number;
    firstConflictU: number | null;
  }>;
  /** Control: a road far outside the city must evict nothing. */
  control: { roadId: string; evicted: number };
  /** Base/perturbed snapshots are kept for rendering. */
  baseWorld: WorldSnapshot;
  perturbedWorld: WorldSnapshot;
  /**
   * True generated footprints (colliders carry `yaw`; the snapshot does not).
   * The plan renderer must use these or every building is drawn axis-aligned.
   */
  baseFootprints: Footprint[];
  perturbedFootprints: Footprint[];
}

function nearestSegment(x: number, z: number, segments: readonly RoadSegment[]): { seg: RoadSegment; d: number } {
  let best = segments[0];
  let bestD = Infinity;
  for (const s of segments) {
    const d = centrelineDistance(x, z, s);
    if (d < bestD) { bestD = d; best = s; }
  }
  return { seg: best, d: bestD };
}

const LEGACY_ORDER_SNAPSHOT: RoadSegment[] = [...ROAD_SEGMENTS];

/**
 * A generated building collider. The audit reads geometry from colliders, not
 * from `WorldSnapshot`: the snapshot carries no `yaw`, and every corridor test
 * is orientation-sensitive.
 */
export interface BuiltCollider extends Footprint {
  cx: number;
  cz: number;
  halfX: number;
  halfZ: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  kind: string;
}

export interface BuiltWorld {
  colliders: BuiltCollider[];
  /** Buildings with an oriented footprint (what can be corridor-tested). */
  traced: BuiltCollider[];
  /** Building colliders with no `yaw`/half extents — axis-aligned authored boxes. */
  untraced: BuiltCollider[];
  snapshot: WorldSnapshot;
  digest: string;
}

function colliderKey(c: { minX: number; maxX: number; minZ: number; maxZ: number; height: number }): string {
  return `${c.minX.toFixed(3)},${c.maxX.toFixed(3)},${c.minZ.toFixed(3)},${c.maxZ.toFixed(3)},${c.height.toFixed(2)}`;
}

/** Build the world with `extra` segments installed, restoring graph + index after. */
export async function buildWith(extra: RoadSegment[]): Promise<BuiltWorld> {
  const [{ buildCity }, { SignAtlas }, { worldDigest }] = await Promise.all([
    import('../../src/world/city'),
    import('../../src/world/textures'),
    import('../../tools/worldSnapshot'),
  ]);
  try {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...LEGACY_ORDER_SNAPSHOT, ...extra);
    // Without this the injected road is invisible to every corridor query.
    rebuildRoadSpatialIndex();
    const city = buildCity(new SignAtlas() as never, { shadows: true } as never) as unknown as {
      colliders: Array<Record<string, unknown>>;
    };
    const all = city.colliders.filter((c) => c.kind === 'building') as unknown as BuiltCollider[];
    const traced = all.filter((c) => Number.isFinite(c.cx) && Number.isFinite(c.cz)
      && Number.isFinite(c.yaw) && Number.isFinite(c.halfX) && Number.isFinite(c.halfZ));
    const untraced = all.filter((c) => !traced.includes(c));
    const snapshot = buildWorldSnapshot(city as never);
    return { colliders: all, traced, untraced, snapshot, digest: worldDigest(snapshot) };
  } finally {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...LEGACY_ORDER_SNAPSHOT);
    rebuildRoadSpatialIndex();
  }
}

/** Footprint from a traced collider (colliders store half extents). */
function fpOf(c: BuiltCollider): Footprint {
  return { x: c.cx, z: c.cz, width: c.halfX * 2, depth: c.halfZ * 2, yaw: c.yaw, height: c.height };
}

export async function runAudit(): Promise<AuditResult> {
  const baseBuilt = await buildWith([]);
  const pertBuilt = await buildWith([SYNTHETIC_ROAD]);
  // Control: a road 700 m west of everything, far outside the shipped blocks.
  // It proves the act of adding *a* road is not itself evicting anything.
  const controlRoad: RoadSegment = {
    ...SYNTHETIC_ROAD,
    id: 'synth_control',
    from: 'synth_control_a',
    to: 'synth_control_b',
    ax: -900, az: -100, bx: -700, bz: 100,
  };
  const controlBuilt = await buildWith([controlRoad]);

  const pool = new Map<string, BuiltCollider[]>();
  for (const c of pertBuilt.traced) {
    const k = colliderKey(c);
    const list = pool.get(k) ?? [];
    list.push(c);
    pool.set(k, list);
  }
  const evicted: Array<{ collider: BuiltCollider; fp: Footprint; key: string }> = [];
  for (const c of baseBuilt.traced) {
    const k = colliderKey(c);
    const list = pool.get(k);
    if (list && list.length > 0) list.pop();
    else evicted.push({ collider: c, fp: fpOf(c), key: k });
  }

  // Any *untraced* base collider that vanished is a separate question: it has no
  // oriented footprint, so it cannot be corridor-tested. Counted, not hidden.
  const untracedPool = new Map<string, number>();
  for (const c of pertBuilt.untraced) untracedPool.set(colliderKey(c), (untracedPool.get(colliderKey(c)) ?? 0) + 1);
  let untracedEvicted = 0;
  for (const c of baseBuilt.untraced) {
    const k = colliderKey(c);
    const n = untracedPool.get(k) ?? 0;
    if (n > 0) untracedPool.set(k, n - 1);
    else untracedEvicted++;
  }

  const controlPool = new Map<string, number>();
  for (const c of controlBuilt.traced) controlPool.set(colliderKey(c), (controlPool.get(colliderKey(c)) ?? 0) + 1);
  let controlEvicted = 0;
  for (const c of baseBuilt.traced) {
    const k = colliderKey(c);
    const n = controlPool.get(k) ?? 0;
    if (n > 0) controlPool.set(k, n - 1);
    else controlEvicted++;
  }

  // Corridor verdicts MUST be measured with the synthetic road present. Doing
  // this after the restore reads the shipped graph and reports every building as
  // clear — a measurement bug that hid every corridor-only eviction.
  const rows: EvictionRow[] = [];
  try {
    ROAD_SEGMENTS.push(SYNTHETIC_ROAD);
    rebuildRoadSpatialIndex();
    for (const { fp, key } of evicted) rows.push(makeRow(fp, key));
  } finally {
    ROAD_SEGMENTS.length = 0;
    ROAD_SEGMENTS.push(...LEGACY_ORDER_SNAPSHOT);
    rebuildRoadSpatialIndex();
  }

  function makeRow(fp: Footprint, key: string): EvictionRow {
    const d = centrelineDistance(fp.x, fp.z, SYNTHETIC_ROAD);
    const sat = obbVsStadium(fp, SYNTHETIC_ROAD, SYNTHETIC_ROAD.halfWidth);
    const after = nearestSegment(fp.x, fp.z, [...LEGACY_ORDER_SNAPSHOT, SYNTHETIC_ROAD]);
    const before = nearestSegment(fp.x, fp.z, LEGACY_ORDER_SNAPSHOT);
    const local = segLocal(fp.x, fp.z, before.seg);
    return {
      key,
      id: `${before.seg.id}:${fp.x.toFixed(2)},${fp.z.toFixed(2)}`,
      x: fp.x, z: fp.z,
      width: fp.width, depth: fp.depth, height: fp.height, yaw: fp.yaw,
      baseSegment: before.seg.id,
      frontSegment: before.seg.id,
      frontSide: (local.v >= 0 ? 1 : -1) as 1 | -1,
      frontU: local.u,
      nearestAfter: after.seg.id,
      distanceToCentreline: d,
      clearCentreAsphalt: d - SYNTHETIC_ROAD.halfWidth,
      clearCentreCorridor: d - (SYNTHETIC_ROAD.halfWidth + SYNTHETIC_ROAD.sidewalk),
      asphaltOverlapDepth: sat.depth,
      asphaltLateralClearance: sat.lateralClearance,
      engineAllows: isFootprintClearOfCorridor(fp.x, fp.z, fp.width, fp.depth, fp.yaw, 0.55),
      engineAllowsNoSetback: isFootprintClearOfCorridor(fp.x, fp.z, fp.width, fp.depth, fp.yaw, 0),
      cls: 'unexplained',
      replacements: 0,
      replacementHeights: [],
    };
  }

  // --- classify
  //
  // The coupling is per SEGMENT, not per frontage side. `buildCity()` creates one
  // `const bRng = buildingRngFor(seg.id)` per segment and runs `for (side of
  // [-1, 1])` against it, so side -1 is generated first and every draw it
  // consumes shifts every draw side +1 sees. A rejected candidate consumes 3
  // draws and advances `along` by 4.5 m; an accepted one consumes ~15 and
  // advances by the building width. One rejection therefore re-rolls the rest of
  // that segment's frontage on BOTH sides.
  //
  // Draw order is (side -1, ascending u) then (side +1, ascending u).
  const drawOrder = (r: EvictionRow): number => (r.frontSide === -1 ? 0 : 1) * 1e6 + r.frontU;
  const direct = rows.filter((r) => r.asphaltOverlapDepth > 0 || !r.engineAllows);
  for (const r of direct) {
    r.cls = r.asphaltOverlapDepth > 0 ? 'carriageway-overlap' : 'corridor-clearance';
  }

  const firstConflict = new Map<string, EvictionRow>();
  for (const r of direct) {
    const prev = firstConflict.get(r.frontSegment);
    if (!prev || drawOrder(r) < drawOrder(prev)) firstConflict.set(r.frontSegment, r);
  }
  for (const r of rows) {
    if (r.cls !== 'unexplained') continue;
    const barrier = firstConflict.get(r.frontSegment);
    if (barrier && drawOrder(r) > drawOrder(barrier)) {
      r.cls = 'frontage-reroll';
      r.causedBy = barrier.key;
    }
  }

  // What stands near a re-rolled building's old slot now?
  const byFrontage = new Map<string, Array<{ u: number; side: 1 | -1; height: number }>>();
  for (const b of pertBuilt.traced) {
    const near = nearestSegment(b.cx, b.cz, LEGACY_ORDER_SNAPSHOT);
    const local = segLocal(b.cx, b.cz, near.seg);
    const k = near.seg.id;
    const list = byFrontage.get(k) ?? [];
    list.push({ u: local.u, side: local.v >= 0 ? 1 : -1, height: b.height });
    byFrontage.set(k, list);
  }
  for (const r of rows) {
    const near = byFrontage.get(r.frontSegment) ?? [];
    const close = near.filter((b) => Math.abs(b.u - r.frontU) <= 15);
    r.replacements = close.length;
    r.replacementHeights = close.slice(0, 6).map((b) => b.height.toFixed(2));
  }

  const counts: Record<EvictionClass, number> = {
    'carriageway-overlap': 0,
    'corridor-clearance': 0,
    'frontage-reroll': 0,
    unexplained: 0,
  };
  for (const r of rows) counts[r.cls]++;

  const frontageMap = new Map<string, AuditResult['frontages'][number]>();
  for (const r of rows) {
    const k = r.frontSegment;
    const entry = frontageMap.get(k) ?? {
      segmentId: k, side: r.frontSide, evicted: 0, directConflicts: 0, firstConflictU: null,
    };
    entry.evicted++;
    if (r.cls === 'carriageway-overlap' || r.cls === 'corridor-clearance') entry.directConflicts++;
    frontageMap.set(k, entry);
  }
  for (const [k, r] of firstConflict) {
    const e = frontageMap.get(k);
    if (e) { e.firstConflictU = r.frontU; e.side = r.frontSide; }
  }

  const addedPool = new Map<string, number>();
  for (const c of pertBuilt.traced) addedPool.set(colliderKey(c), (addedPool.get(colliderKey(c)) ?? 0) + 1);
  for (const c of baseBuilt.traced) {
    const k = colliderKey(c);
    const n = addedPool.get(k) ?? 0;
    if (n > 0) addedPool.set(k, n - 1);
  }
  let added = 0;
  for (const c of pertBuilt.untraced) addedPool.set(colliderKey(c), 1);
  for (const n of addedPool.values()) added += n;

  return {
    baseCampaign: { buildings: baseBuilt.snapshot.counts.buildings, digest: baseBuilt.digest },
    perturbed: { buildings: pertBuilt.snapshot.counts.buildings, digest: pertBuilt.digest },
    evicted: rows.length,
    added,
    untracedEvicted,
    rows,
    counts,
    frontages: [...frontageMap.values()].sort((a, b) => b.evicted - a.evicted),
    control: { roadId: controlRoad.id, evicted: controlEvicted },
    baseWorld: baseBuilt.snapshot,
    perturbedWorld: pertBuilt.snapshot,
    baseFootprints: baseBuilt.traced.map(fpOf),
    perturbedFootprints: pertBuilt.traced.map(fpOf),
  };
}
