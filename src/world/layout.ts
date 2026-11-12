/**
 * Connected Mohammadpur (Dhaka) street-network graph, spatial clearance field,
 * landmark definitions and Dijkstra route pathfinder.
 *
 * Pure data + pure math (no Three.js, no DOM) so unit tests can verify road
 * connectivity, pathfinding, dead-end handling, and zero-lane-intrusion rules.
 */

import { clamp } from '../core/mathx';
import { landmarkById, type Landmark } from './landmarks';
import {
  arcLengthOf,
  nearestOf,
  poseAt,
  projectOntoPolyline,
  type Vec2,
} from './roadGeometry';
import {
  MOHAMMADPUR_EDGES,
  MOHAMMADPUR_NODES,
  OSM_ATTRIBUTION,
  type OsmSourceKind,
  type StreetCategory,
} from './mohammadpurData';

export { OSM_ATTRIBUTION };
export type RoadKind = StreetCategory;

export interface GraphNode {
  id: string;
  x: number;
  z: number;
  label: string;
  signal: boolean;
  /** Junction carriageway disc radius (half of widest incident road + fillet). */
  radius: number;
  /** Outer sidewalk apron radius around the junction. */
  outerRadius: number;
  incidentEdgeIds: string[];
  deadEnd: boolean;
}

export interface RoadSegment {
  id: string;
  from: string;
  to: string;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  length: number;
  /** Unit tangent from A -> B. */
  ux: number;
  uz: number;
  /** Unit left-hand normal in Bangladesh driving convention: (uz, -ux). */
  leftX: number;
  leftZ: number;
  width: number;
  halfWidth: number;
  sidewalk: number;
  kind: RoadKind;
  nameEn: string;
  nameBn: string;
  source: OsmSourceKind;
  osmWayId?: number;
  jamProne: boolean;
  deadEnd: boolean;
  /**
   * Optional authored centreline, *including* both endpoints.
   *
   * Absent on every segment except the ones listed in
   * `COLLINEAR_SUBDIVISIONS`. When present, `vertices[0]` equals `(ax,az)` and
   * the last vertex equals `(bx,bz)` exactly, so the junction nodes and the
   * gameplay graph are untouched. Interior vertices are not nodes.
   *
   * Consume via `src/world/roadGeometry.ts` (`poseAt`, `offsetPoint`,
   * `projectOntoPolyline`, `arcLengthOf`) rather than doing vector algebra here.
   * `length` below remains the **chord** between the junctions; polyline length
   * is a separate query and is never substituted for it silently.
   */
  vertices?: readonly Vec2[];
  // Backwards-compatible summary fields for minimap/legacy callers
  axis: 'x' | 'z';
  center: number;
  fromCoord: number;
  toCoord: number;
}

export type RoadDef = RoadSegment;

const nodeMap = new Map<string, GraphNode>();
for (const raw of MOHAMMADPUR_NODES) {
  nodeMap.set(raw.id, {
    id: raw.id,
    x: raw.x,
    z: raw.z,
    label: raw.label ?? raw.id,
    signal: !!raw.signal,
    radius: 4.5,
    outerRadius: 6.8,
    incidentEdgeIds: [],
    deadEnd: false,
  });
}

export const ROAD_SEGMENTS: RoadSegment[] = [];
const segmentMap = new Map<string, RoadSegment>();

for (const e of MOHAMMADPUR_EDGES) {
  const a = nodeMap.get(e.from);
  const b = nodeMap.get(e.to);
  if (!a || !b) continue;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.max(0.01, Math.hypot(dx, dz));
  const ux = dx / length;
  const uz = dz / length;
  // Facing (ux, uz) in Three.js (+X right-east, +Z south):
  // up x forward = (0,1,0) x (ux, 0, uz) = (uz, 0, -ux) -> true LEFT side of road!
  const leftX = uz;
  const leftZ = -ux;
  const axis: 'x' | 'z' = Math.abs(dx) >= Math.abs(dz) ? 'x' : 'z';

  const seg: RoadSegment = {
    id: e.id,
    from: e.from,
    to: e.to,
    ax: a.x,
    az: a.z,
    bx: b.x,
    bz: b.z,
    length,
    ux,
    uz,
    leftX,
    leftZ,
    width: e.width,
    halfWidth: e.width * 0.5,
    sidewalk: e.sidewalk,
    kind: e.kind,
    nameEn: e.nameEn,
    nameBn: e.nameBn,
    source: e.source,
    osmWayId: e.osmWayId,
    jamProne: !!e.jamProne,
    deadEnd: false,
    axis,
    center: axis === 'z' ? (a.x + b.x) * 0.5 : (a.z + b.z) * 0.5,
    fromCoord: axis === 'z' ? Math.min(a.z, b.z) : Math.min(a.x, b.x),
    toCoord: axis === 'z' ? Math.max(a.z, b.z) : Math.max(a.x, b.x),
  };

  ROAD_SEGMENTS.push(seg);
  segmentMap.set(seg.id, seg);
  a.incidentEdgeIds.push(seg.id);
  b.incidentEdgeIds.push(seg.id);
}

/* ----------------------- Phase 1: collinear subdivision ------------------- */

/**
 * Phase 1 polyline prototype — **collinear**, deliberately.
 *
 * `asad_4` is the single segment given an authored centreline, with vertices at
 * 0 %, 50 % and 100 % of its existing chord. The polyline is therefore exactly
 * collinear with the chord it replaces, so it changes *nothing* geometrically:
 * the same junction nodes, the same asphalt footprint, the same arc length, the
 * same lane graph, the same buildings, the same race distances.
 *
 * Its purpose is to prove the whole polyline pipeline (derivation, span
 * resampling, sampling, rendering, minimap) end-to-end on a real and heavily
 * referenced segment while both golden baselines stay at zero diff. Real curved
 * geometry for this segment is a **separate, unapproved** proposal.
 *
 * Endpoints are written from `ax/az` and `bx/bz` directly, never recomputed from
 * the fraction, so `vertices[0] === (ax,az)` and the last vertex `=== (bx,bz)`
 * hold exactly and junction identity cannot drift by a rounding step.
 */
const COLLINEAR_SUBDIVISIONS: Record<string, readonly number[]> = {
  asad_4: [0, 0.5, 1],
};

function applyCollinearSubdivisions(): void {
  for (const [id, fractions] of Object.entries(COLLINEAR_SUBDIVISIONS)) {
    const seg = segmentMap.get(id);
    if (!seg) {
      throw new Error(`[layout] collinear subdivision targets unknown segment "${id}"`);
    }
    const sorted = [...fractions].sort((p, q) => p - q);
    if (sorted.length < 2 || sorted[0] !== 0 || sorted[sorted.length - 1] !== 1) {
      throw new Error(`[layout] subdivision for "${id}" must start at 0 and end at 1`);
    }
    seg.vertices = sorted.map((f, i) => {
      if (i === 0) return { x: seg.ax, z: seg.az };
      if (i === sorted.length - 1) return { x: seg.bx, z: seg.bz };
      // Multiplication by the fraction is exact enough that the interior vertex
      // stays collinear to <1e-14 world units (<3e-14 m).
      return { x: seg.ax + (seg.bx - seg.ax) * f, z: seg.az + (seg.bz - seg.az) * f };
    });
  }
}

applyCollinearSubdivisions();

export const GRAPH_NODES: GraphNode[] = [...nodeMap.values()];
for (const n of GRAPH_NODES) {
  let maxHalf = 3.0;
  let maxOuter = 4.8;
  for (const id of n.incidentEdgeIds) {
    const s = segmentMap.get(id)!;
    if (s.halfWidth > maxHalf) maxHalf = s.halfWidth;
    if (s.halfWidth + s.sidewalk > maxOuter) maxOuter = s.halfWidth + s.sidewalk;
  }
  n.deadEnd = n.incidentEdgeIds.length <= 1;
  n.radius = maxHalf + (n.deadEnd ? 0.6 : 0.75);
  n.outerRadius = maxOuter + 0.65;
}
for (const s of ROAD_SEGMENTS) {
  const na = nodeMap.get(s.from)!;
  const nb = nodeMap.get(s.to)!;
  s.deadEnd = na.deadEnd || nb.deadEnd;
}

/** Backwards-compatible alias consumed by minimap & tests. */
export const ROADS: RoadSegment[] = ROAD_SEGMENTS;

export function nodeById(id: string): GraphNode | undefined {
  return nodeMap.get(id);
}

export function segmentById(id: string): RoadSegment | undefined {
  return segmentMap.get(id);
}

/* ------------------------------------------------ fast spatial road lookup */

const CELL_SIZE = 24;
const GRID_MIN = -312;
const GRID_COLS = 28; // covers [-312 .. +360]

interface CellBucket {
  segments: RoadSegment[];
  nodes: GraphNode[];
}

const spatialCells: CellBucket[] = Array.from({ length: GRID_COLS * GRID_COLS }, () => ({
  segments: [],
  nodes: [],
}));

function cellIdx(cx: number, cz: number): number {
  return cz * GRID_COLS + cx;
}

function worldToCell(v: number): number {
  return clamp(Math.floor((v - GRID_MIN) / CELL_SIZE), 0, GRID_COLS - 1);
}

for (const s of ROAD_SEGMENTS) {
  const pad = s.halfWidth + s.sidewalk + 8;
  const c0x = worldToCell(Math.min(s.ax, s.bx) - pad);
  const c1x = worldToCell(Math.max(s.ax, s.bx) + pad);
  const c0z = worldToCell(Math.min(s.az, s.bz) - pad);
  const c1z = worldToCell(Math.max(s.az, s.bz) + pad);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      spatialCells[cellIdx(cx, cz)].segments.push(s);
    }
  }
}

for (const n of GRAPH_NODES) {
  const pad = n.outerRadius + 8;
  const c0x = worldToCell(n.x - pad);
  const c1x = worldToCell(n.x + pad);
  const c0z = worldToCell(n.z - pad);
  const c1z = worldToCell(n.z + pad);
  for (let cz = c0z; cz <= c1z; cz++) {
    for (let cx = c0x; cx <= c1x; cx++) {
      spatialCells[cellIdx(cx, cz)].nodes.push(n);
    }
  }
}

export function pointToSegmentDistance(
  px: number,
  pz: number,
  s: RoadSegment,
): { dist: number; t: number; cx: number; cz: number } {
  // Polyline projection. `t` stays a normalised fraction of the road's own
  // length, now the arc length, so its meaning ("how far along, 0..1") is
  // unchanged while the point it refers to follows the drawn centreline.
  const proj = projectOntoPolyline(s, px, pz);
  const cx = proj.x;
  const cz = proj.z;
  const arc = arcLengthOf(s);
  return { dist: Math.hypot(px - cx, pz - cz), t: arc === 0 ? 0 : proj.s / arc, cx, cz };
}

/**
 * Exact signed distance from `(x, z)` to the nearest driving carriageway or
 * junction disc:
 *   <= 0  inside drivable asphalt road or intersection
 *   >  0  metres outside all driving lanes
 */
export function distanceToRoadCarriageway(x: number, z: number): number {
  const bucket = spatialCells[cellIdx(worldToCell(x), worldToCell(z))];
  let minSigned = 999;
  for (let i = 0; i < bucket.segments.length; i++) {
    const s = bucket.segments[i];
    // Polyline projection so a curved carriageway is measured against the road
    // that is actually drawn. Straight segments are bit-identical.
    const proj = projectOntoPolyline(s, x, z);
    const d = Math.hypot(x - proj.x, z - proj.z) - s.halfWidth;
    if (d < minSigned) minSigned = d;
  }
  for (let i = 0; i < bucket.nodes.length; i++) {
    const n = bucket.nodes[i];
    const d = Math.hypot(x - n.x, z - n.z) - n.radius;
    if (d < minSigned) minSigned = d;
  }
  return minSigned;
}

/**
 * Signed distance to the outer edge of the sidewalk (carriageway + sidewalk).
 *   <= 0  on road OR sidewalk
 *   >  0  inside buildable block interior (off-road)
 */
export function distanceToRoadCorridor(x: number, z: number): number {
  const bucket = spatialCells[cellIdx(worldToCell(x), worldToCell(z))];
  let minSigned = 999;
  for (let i = 0; i < bucket.segments.length; i++) {
    const s = bucket.segments[i];
    // Polyline projection, matching distanceToRoadCarriageway.
    const proj = projectOntoPolyline(s, x, z);
    const d = Math.hypot(x - proj.x, z - proj.z) - (s.halfWidth + s.sidewalk);
    if (d < minSigned) minSigned = d;
  }
  for (let i = 0; i < bucket.nodes.length; i++) {
    const n = bucket.nodes[i];
    const d = Math.hypot(x - n.x, z - n.z) - n.outerRadius;
    if (d < minSigned) minSigned = d;
  }
  return minSigned;
}

export function surfaceAtWorld(x: number, z: number): 'road' | 'sidewalk' | 'offroad' {
  const dRoad = distanceToRoadCarriageway(x, z);
  if (dRoad <= 0.05) return 'road';
  const dCorridor = distanceToRoadCorridor(x, z);
  if (dCorridor <= 0.05) return 'sidewalk';
  return 'offroad';
}

/** True only if `(x, z)` sits at least `minClearance` metres outside EVERY driving lane & junction. */
export function isClearOfRoads(x: number, z: number, minClearance = 0.55): boolean {
  return distanceToRoadCarriageway(x, z) >= minClearance;
}

/**
 * Validates an oriented rectangular footprint `(cx, cz, width, depth, yaw)` so
 * NO corner, edge midpoint, or centre ever overlaps a road or sidewalk corridor.
 */
export function isFootprintClearOfCorridor(
  cx: number,
  cz: number,
  width: number,
  depth: number,
  yaw: number,
  extraSetback = 0.35,
): boolean {
  const hw = width * 0.5;
  const hd = depth * 0.5;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Quick bounding-circle check first
  const centerDist = distanceToRoadCorridor(cx, cz);
  const diag = Math.hypot(hw, hd);
  if (centerDist >= diag + extraSetback) return true;
  if (centerDist < -diag) return false;

  const samples: [number, number][] = [
    [0, 0],
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
    [0, -hd],
    [0, hd],
    [-hw, 0],
    [hw, 0],
  ];
  for (const [lx, lz] of samples) {
    const wx = cx + lx * c + lz * s;
    const wz = cz - lx * s + lz * c;
    if (distanceToRoadCorridor(wx, wz) < extraSetback) return false;
  }
  return true;
}

/** Nearest drivable point + left-hand lane heading on the Mohammadpur street network. */
/**
 * Drivable pose for approaching a place: on the place's OWN segment, in the
 * near lane just inside the curb.
 *
 * Deliberately not `snapToNearestRoad`: that snaps to whichever centreline is
 * closest, which near a junction can be a different (crossing) street — 9.2 m
 * from the marker at Town Hall Bazar, i.e. outside `MISSION.acceptRadius`, so a
 * teleport there could never trigger the pickup.
 */
export function placeApproachPose(placeId: string): { x: number; z: number; yaw: number } | null {
  const place = placeById(placeId);
  if (!place) return null;
  const seg = segmentById(place.segmentId);
  if (!seg) return { x: place.x, z: place.z, yaw: place.heading };
  // Polyline projection so the approach pose stays on the asphalt on a curved
  // road. The lateral sign and the half-metre inset are unchanged; only the
  // frame they are applied in is now the local span frame rather than the chord.
  const proj = projectOntoPolyline(seg, place.x, place.z);
  const side = proj.lateral >= 0 ? 1 : -1;
  // Stay on the asphalt, half a metre inside the curb, on the marker's side.
  const laneOffset = (seg.halfWidth - 0.5) * side;
  const frame = poseAt(seg, proj.s);
  return {
    x: frame.x + frame.leftX * laneOffset,
    z: frame.z + frame.leftZ * laneOffset,
    yaw: place.heading,
  };
}

export function snapToNearestRoad(
  x: number,
  z: number,
  allowGali = true,
  /**
   * Explicit road scope. Defaults to every segment, which is correct for
   * gameplay ("what road am I on?"). Generation passes that must not react to
   * *new* roads pass a frozen subset so adding a road elsewhere cannot change
   * an existing building's orientation.
   */
  scope: readonly RoadSegment[] = ROAD_SEGMENTS,
): { x: number; z: number; yaw: number; segment: RoadSegment } {
  // Selection and clamping live in `roadGeometry.nearestOf` so they can be
  // tested against synthetic curved geometry. The margin is unchanged: the same
  // junction clearance the previous chord implementation used.
  const snap = nearestOf(scope, x, z, {
    marginOf: (s) => Math.min(4, s.length * 0.2),
    skip: (s) => !allowGali && s.kind === 'gali',
  });

  if (!snap) {
    // Every segment was excluded (only reachable if the graph had no non-gali
    // road). Preserve the previous fallback rather than throwing.
    const fallback = scope[0] ?? ROAD_SEGMENTS[0];
    return { x, z, yaw: Math.atan2(fallback.ux, fallback.uz), segment: fallback };
  }

  // Offset slightly onto the Bangladesh left-hand lane, along the *local* normal
  const laneOffset = Math.min(1.6, snap.segment.halfWidth * 0.42);
  return {
    x: snap.pose.x + snap.pose.leftX * laneOffset,
    z: snap.pose.z + snap.pose.leftZ * laneOffset,
    yaw: Math.atan2(snap.pose.ux, snap.pose.uz),
    segment: snap.segment,
  };
}

/* ------------------------------------------- Mohammadpur landmarks/places */

export interface PlaceDef {
  id: string;
  nameKey: string;
  x: number;
  z: number;
  kind: 'pickup' | 'drop' | 'both' | 'poi';
  /** Suggested heading for parked rickshaws near this place (radians). */
  heading: number;
  marker?: number;
  segmentId: string;
}

function makePlaceOnSegment(
  id: string,
  nameKey: string,
  segmentId: string,
  tAlong: number,
  side: 1 | -1,
  kind: PlaceDef['kind'] = 'both',
): PlaceDef {
  const s = segmentById(segmentId) ?? ROAD_SEGMENTS[0];
  // Fraction of the *arc* length, so a curved segment places the marker the same
  // proportion of the way along the road it actually is. For the straight and
  // collinear segments in the graph today this equals the chord fraction exactly.
  const along = clamp(tAlong, 0.22, 0.78) * arcLengthOf(s);
  const frame = poseAt(s, along);
  const cx = frame.x;
  const cz = frame.z;
  // v0.7.0: sit just outside the curb instead of at 0.58 x half-width, which
  // is *inside* the carriageway. The curb line is chosen over mid-sidewalk on
  // purpose: it is unambiguous of the asphalt, still well within
  // MISSION.acceptRadius of a vehicle, and as far as possible from the building
  // frontage, so a marker cannot end up buried in a shopfront (which mid-
  // sidewalk placement caused at the bus stand).
  const curb = (s.halfWidth + PLACE_CURB_CLEARANCE) * side;
  // Local tangent: the chord tangent is wrong anywhere but the chord's own axis.
  const heading = side === 1 ? Math.atan2(frame.ux, frame.uz) : Math.atan2(-frame.ux, -frame.uz);
  return {
    id,
    nameKey,
    x: Math.round((cx + frame.leftX * curb) * 10) / 10,
    z: Math.round((cz + frame.leftZ * curb) * 10) / 10,
    kind,
    heading,
    marker: 3.2,
    segmentId: s.id,
  };
}

/**
 * Project `(x, z)` onto the nearest point of a named road segment.
 * Returns the projection parameter plus the signed lateral offset, where a
 * positive value means the point lies on the segment's `leftX`/`leftZ` side.
 */
function projectOntoSegment(
  x: number,
  z: number,
  segmentId: string,
): { along: number; lateral: number; segment: RoadSegment } {
  const s = segmentById(segmentId) ?? ROAD_SEGMENTS[0];
  // Polyline projection: on a curved centreline the chord projection picks the
  // wrong `along` and the wrong lateral sign for points on the inside of a bend.
  // For a straight segment this is bit-identical to the previous chord maths.
  const proj = projectOntoPolyline(s, x, z);
  return { along: proj.s, lateral: proj.lateral, segment: s };
}

/**
 * Build a named place from a *verified* OSM landmark instead of an arbitrary
 * fraction along a road.
 *
 * The marker sits on the sidewalk apron directly outside the carriageway on the
 * side the real feature occupies, so it never intrudes on a traffic lane while
 * still reading as the shopfront the player drives past.
 */
function makePlaceAtLandmark(
  id: string,
  nameKey: string,
  landmarkId: string,
  kind: PlaceDef['kind'] = 'both',
): PlaceDef {
  const lm: Landmark = landmarkById(landmarkId) ?? {
    id: landmarkId,
    nameEn: landmarkId,
    nameBn: landmarkId,
    category: 'road',
    x: 0,
    z: 0,
    source: { osmId: 0, osmType: 'node', lat: 0, lon: 0 },
    confidence: 'approx',
  };
  const { along, lateral, segment: s } = projectOntoSegment(lm.x, lm.z, lm.frontageSegmentId ?? '');
  // Prefer the polygon-voted side; fall back to the point's own side, and to
  // the segment's left if the point sits exactly on the centreline.
  const side: 1 | -1 = lm.frontageSide ?? (lateral >= 0 ? 1 : -1);
  // Just clear of the asphalt: half the carriageway plus most of the sidewalk.
  const apron = s.halfWidth + s.sidewalk * 0.55;
  // `along` is an arc position from the polyline projection, so the apron point
  // must be built from the local span frame rather than the chord frame.
  const frame = poseAt(s, along);
  const heading = side === 1 ? Math.atan2(frame.ux, frame.uz) : Math.atan2(-frame.ux, -frame.uz);
  const px = frame.x + frame.leftX * apron * side;
  const pz = frame.z + frame.leftZ * apron * side;
  return {
    id,
    nameKey,
    x: Math.round(px * 10) / 10,
    z: Math.round(pz * 10) / 10,
    kind,
    heading,
    marker: 3.2,
    segmentId: s.id,
  };
}

/** How far outside the carriageway a place marker sits, in metres. */
export const PLACE_CURB_CLEARANCE = 0.35;

export const PLACES: PlaceDef[] = [
  makePlaceOnSegment('stand', 'place.stand', 'asad_1', 0.26, 1, 'both'),
  // v0.7.0: Town Hall Bazar was previously pinned to an arbitrary point on
  // asad_3, ~39 m west of the real market. Now anchored to OSM way 223068917
  // (amenity=marketplace, addr:street=Asad Avenue).
  makePlaceAtLandmark('bazaar', 'place.bazaar', 'town_hall_bazar', 'both'),
  makePlaceOnSegment('tea', 'place.tea', 'nurjahan_1', 0.52, 1, 'both'),
  makePlaceOnSegment('school', 'place.school', 'iqbal_1', 0.55, 1, 'both'),
  makePlaceOnSegment('garage', 'place.garage', 'shershah_1', 0.48, -1, 'both'),
  makePlaceOnSegment('pharmacy', 'place.pharmacy', 'asad_4', 0.62, 1, 'both'),
  makePlaceOnSegment('launch', 'place.launch', 'satmasjid_1', 0.58, 1, 'both'),
  makePlaceOnSegment('mosque', 'place.mosque', 'ring_2', 0.72, 1, 'both'),
  // v0.7.0: "Krishi Market Corner" was previously placed on Ring Road, 55-75 m
  // from the real wholesale market. Now anchored to OSM way 494999392.
  makePlaceAtLandmark('market', 'place.market', 'krishi_market', 'both'),
  makePlaceOnSegment('bridge', 'place.bridge', 'babar_2', 0.52, 1, 'both'),
  makePlaceOnSegment('library', 'place.library', 'tajmahal_3', 0.5, 1, 'both'),
  makePlaceOnSegment('salimullah', 'place.salimullah', 'salimullah_1', 0.54, -1, 'both'),
  makePlaceOnSegment('humayun', 'place.humayun', 'humayun_2', 0.5, 1, 'both'),
  makePlaceOnSegment('zakir', 'place.zakir', 'zakir_3', 0.52, 1, 'both'),
];

export function placeById(id: string): PlaceDef | undefined {
  return PLACES.find((p) => p.id === id);
}

/* ------------------------------------------------ traffic signal junctions */

export interface SignalIntersection {
  nodeId: string;
  x: number;
  z: number;
  radius: number;
  cycle: number;
  offset: number;
}

export const SIGNALS: SignalIntersection[] = GRAPH_NODES.filter((n) => n.signal).map((n, idx) => ({
  nodeId: n.id,
  x: n.x,
  z: n.z,
  radius: n.radius,
  cycle: 24,
  offset: (idx * 6) % 24,
}));

/* ------------------------------------------- Dijkstra route & detour engine */

export interface RoutePlan {
  nodeIds: string[];
  segmentIds: string[];
  points: { x: number; z: number }[];
  distance: number;
  estimatedSeconds: number;
  avoidedJam: boolean;
}

function nearestNodeId(x: number, z: number): string {
  let best = GRAPH_NODES[0];
  let bestD = Infinity;
  for (const n of GRAPH_NODES) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best.id;
}

/**
 * Shortest-time pathfinder over the Mohammadpur graph.
 * `congestionMultiplier(segmentId)` returns 1.0 for clear roads, up to e.g. 4.5
 * for heavily jammed corridors so navigation automatically suggests real side
 * lanes when Asad Avenue or Town Hall is gridlocked!
 */
export function findRoute(
  startX: number,
  startZ: number,
  goalX: number,
  goalZ: number,
  congestionMultiplier?: (segmentId: string) => number,
  preferRoadApproach = false,
): RoutePlan {
  const startNode = nearestNodeId(startX, startZ);
  // A destination midway along a street must be approached from the cheaper
  // connected end, not from whichever junction is nearest in a straight line.
  // Otherwise the map can guide drivers past a street destination and back
  // through the preceding junction, even though the road was approached directly.
  const goalRoad = preferRoadApproach ? snapToNearestRoad(goalX, goalZ).segment : null;
  const goalAlong = goalRoad ? clamp((goalX - goalRoad.ax) * goalRoad.ux + (goalZ - goalRoad.az) * goalRoad.uz, 0, goalRoad.length) : 0;
  const goalRoadX = goalRoad ? goalRoad.ax + goalAlong * goalRoad.ux : goalX;
  const goalRoadZ = goalRoad ? goalRoad.az + goalAlong * goalRoad.uz : goalZ;
  const goalOnRoad = !!goalRoad && Math.hypot(goalX - goalRoadX, goalZ - goalRoadZ) < goalRoad.halfWidth + 4;
  let goalNode = nearestNodeId(goalX, goalZ);

  const distCost = new Map<string, number>();
  const distMetres = new Map<string, number>();
  const prevNode = new Map<string, string>();
  const prevSeg = new Map<string, string>();
  const visited = new Set<string>();

  for (const n of GRAPH_NODES) {
    distCost.set(n.id, Infinity);
    distMetres.set(n.id, Infinity);
  }
  distCost.set(startNode, 0);
  distMetres.set(startNode, 0);

  while (visited.size < GRAPH_NODES.length) {
    let u: string | null = null;
    let best = Infinity;
    for (const n of GRAPH_NODES) {
      if (visited.has(n.id)) continue;
      const c = distCost.get(n.id) ?? Infinity;
      if (c < best) {
        best = c;
        u = n.id;
      }
    }
    if (!u || (!goalOnRoad && u === goalNode) || !Number.isFinite(best)) break;
    visited.add(u);

    const uNode = nodeMap.get(u)!;
    for (const segId of uNode.incidentEdgeIds) {
      const seg = segmentMap.get(segId)!;
      const v = seg.from === u ? seg.to : seg.from;
      if (visited.has(v)) continue;
      const baseSpeed = seg.kind === 'main' ? 6.2 : seg.kind === 'medium' ? 5.6 : 4.8;
      const jamFactor = congestionMultiplier ? Math.max(1, congestionMultiplier(seg.id)) : 1;
      const edgeSeconds = (seg.length / baseSpeed) * jamFactor;
      const alt = best + edgeSeconds;
      if (alt < (distCost.get(v) ?? Infinity)) {
        distCost.set(v, alt);
        distMetres.set(v, (distMetres.get(u) ?? 0) + seg.length);
        prevNode.set(v, u);
        prevSeg.set(v, seg.id);
      }
    }
  }

  if (goalRoad && goalOnRoad) {
    const speed = goalRoad.kind === 'main' ? 6.2 : goalRoad.kind === 'medium' ? 5.6 : 4.8;
    const jam = congestionMultiplier ? Math.max(1, congestionMultiplier(goalRoad.id)) : 1;
    const throughA = (distCost.get(goalRoad.from) ?? Infinity) + goalAlong / speed * jam;
    const throughB = (distCost.get(goalRoad.to) ?? Infinity) + (goalRoad.length - goalAlong) / speed * jam;
    goalNode = throughA <= throughB ? goalRoad.from : goalRoad.to;
  }

  const nodeIds: string[] = [];
  const segmentIds: string[] = [];
  let cur: string | undefined = goalNode;
  while (cur) {
    nodeIds.push(cur);
    const pSeg = prevSeg.get(cur);
    if (pSeg) segmentIds.push(pSeg);
    cur = prevNode.get(cur);
  }
  nodeIds.reverse();
  segmentIds.reverse();
  if (goalRoad && goalOnRoad && Math.hypot(goalX - nodeMap.get(goalNode)!.x, goalZ - nodeMap.get(goalNode)!.z) > 1 &&
      segmentIds[segmentIds.length - 1] !== goalRoad.id) segmentIds.push(goalRoad.id);

  const points: { x: number; z: number }[] = [{ x: startX, z: startZ }];
  for (const nid of nodeIds) {
    const n = nodeMap.get(nid)!;
    points.push({ x: n.x, z: n.z });
  }
  points.push({ x: goalX, z: goalZ });

  const startExtra = nodeIds.length > 0 ? Math.hypot(startX - nodeMap.get(nodeIds[0])!.x, startZ - nodeMap.get(nodeIds[0])!.z) : 0;
  const endExtra =
    nodeIds.length > 0
      ? Math.hypot(goalX - nodeMap.get(nodeIds[nodeIds.length - 1])!.x, goalZ - nodeMap.get(nodeIds[nodeIds.length - 1])!.z)
      : Math.hypot(goalX - startX, goalZ - startZ);
  const totalDist = Math.max(25, Math.round((distMetres.get(goalNode) ?? 0) + startExtra * 0.5 + endExtra * 0.5));

  let avoidedJam = false;
  if (congestionMultiplier) {
    const unjammed = findRoute(startX, startZ, goalX, goalZ, undefined, preferRoadApproach);
    avoidedJam = unjammed.segmentIds.join(',') !== segmentIds.join(',');
  }

  return {
    nodeIds,
    segmentIds,
    points,
    distance: totalDist,
    estimatedSeconds: distCost.get(goalNode) ?? totalDist / 5,
    avoidedJam,
  };
}

/** Backwards-compatible block interface for any caller expecting legacy blocks. */
export const BLOCKS: { id: string; minX: number; maxX: number; minZ: number; maxZ: number; district: 'bazaar' | 'housing' | 'canal' }[] = [];
