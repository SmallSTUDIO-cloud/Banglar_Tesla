/**
 * Connected Mohammadpur (Dhaka) street-network graph, spatial clearance field,
 * landmark definitions and Dijkstra route pathfinder.
 *
 * Pure data + pure math (no Three.js, no DOM) so unit tests can verify road
 * connectivity, pathfinding, dead-end handling, and zero-lane-intrusion rules.
 */

import { clamp } from '../core/mathx';
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
  const vx = px - s.ax;
  const vz = pz - s.az;
  const proj = clamp(vx * s.ux + vz * s.uz, 0, s.length);
  const cx = s.ax + s.ux * proj;
  const cz = s.az + s.uz * proj;
  return { dist: Math.hypot(px - cx, pz - cz), t: proj / s.length, cx, cz };
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
    const vx = x - s.ax;
    const vz = z - s.az;
    const proj = clamp(vx * s.ux + vz * s.uz, 0, s.length);
    const d = Math.hypot(x - (s.ax + s.ux * proj), z - (s.az + s.uz * proj)) - s.halfWidth;
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
    const vx = x - s.ax;
    const vz = z - s.az;
    const proj = clamp(vx * s.ux + vz * s.uz, 0, s.length);
    const d = Math.hypot(x - (s.ax + s.ux * proj), z - (s.az + s.uz * proj)) - (s.halfWidth + s.sidewalk);
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
export function snapToNearestRoad(
  x: number,
  z: number,
  allowGali = true,
): { x: number; z: number; yaw: number; segment: RoadSegment } {
  let bestSeg = ROAD_SEGMENTS[0];
  let bestDist = Infinity;
  let bestX = x;
  let bestZ = z;
  for (const s of ROAD_SEGMENTS) {
    if (!allowGali && s.kind === 'gali') continue;
    const margin = Math.min(4, s.length * 0.2);
    const vx = x - s.ax;
    const vz = z - s.az;
    const proj = clamp(vx * s.ux + vz * s.uz, margin, s.length - margin);
    const cx = s.ax + s.ux * proj;
    const cz = s.az + s.uz * proj;
    const d = Math.hypot(x - cx, z - cz);
    if (d < bestDist) {
      bestDist = d;
      bestSeg = s;
      bestX = cx;
      bestZ = cz;
    }
  }
  // Offset slightly onto the Bangladesh left-hand lane
  const laneOffset = Math.min(1.6, bestSeg.halfWidth * 0.42);
  return {
    x: bestX + bestSeg.leftX * laneOffset,
    z: bestZ + bestSeg.leftZ * laneOffset,
    yaw: Math.atan2(bestSeg.ux, bestSeg.uz),
    segment: bestSeg,
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
  const along = clamp(tAlong, 0.22, 0.78) * s.length;
  const cx = s.ax + s.ux * along;
  const cz = s.az + s.uz * along;
  const curb = s.halfWidth * 0.58 * side;
  const heading = side === 1 ? Math.atan2(s.ux, s.uz) : Math.atan2(-s.ux, -s.uz);
  return {
    id,
    nameKey,
    x: Math.round((cx + s.leftX * curb) * 10) / 10,
    z: Math.round((cz + s.leftZ * curb) * 10) / 10,
    kind,
    heading,
    marker: 3.2,
    segmentId: s.id,
  };
}

export const PLACES: PlaceDef[] = [
  makePlaceOnSegment('stand', 'place.stand', 'asad_1', 0.26, 1, 'both'),
  makePlaceOnSegment('bazaar', 'place.bazaar', 'asad_3', 0.68, 1, 'both'),
  makePlaceOnSegment('tea', 'place.tea', 'nurjahan_1', 0.52, 1, 'both'),
  makePlaceOnSegment('school', 'place.school', 'iqbal_1', 0.55, 1, 'both'),
  makePlaceOnSegment('garage', 'place.garage', 'shershah_1', 0.48, -1, 'both'),
  makePlaceOnSegment('pharmacy', 'place.pharmacy', 'asad_4', 0.62, 1, 'both'),
  makePlaceOnSegment('launch', 'place.launch', 'satmasjid_1', 0.58, 1, 'both'),
  makePlaceOnSegment('mosque', 'place.mosque', 'ring_2', 0.72, 1, 'both'),
  makePlaceOnSegment('market', 'place.market', 'ring_3', 0.45, -1, 'both'),
  makePlaceOnSegment('bridge', 'place.bridge', 'babar_2', 0.52, 1, 'both'),
  makePlaceOnSegment('library', 'place.library', 'tajmahal_3', 0.5, 1, 'both'),
  makePlaceOnSegment('salimullah', 'place.salimullah', 'salimullah_1', 0.54, -1, 'both'),
  makePlaceOnSegment('humayun', 'place.humayun', 'humayun_2', 0.5, 1, 'both'),
  makePlaceOnSegment('zakir', 'place.zakir', 'zakir_3', 0.52, 1, 'both'),
  // Two public-road approaches to the approximate in-game campus entrances.
  makePlaceOnSegment('drmc', 'place.drmc', 'shahjahan_2', 0.38, 1, 'both'),
  makePlaceOnSegment('drmc_side', 'place.drmcSide', 'aurangzeb_humayun', 0.52, -1, 'poi'),
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
): RoutePlan {
  const startNode = nearestNodeId(startX, startZ);
  const goalNode = nearestNodeId(goalX, goalZ);

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
    if (!u || u === goalNode || !Number.isFinite(best)) break;
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
    const unjammed = findRoute(startX, startZ, goalX, goalZ);
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
