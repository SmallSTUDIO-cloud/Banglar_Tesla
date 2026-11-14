/**
 * Lane-graph snapshot — drift protection for the derived traffic lane layer.
 *
 * Why this exists
 * ---------------
 * `data/mohammadpur/gameplay-baseline.json` pins the authored road graph, and
 * `data/mohammadpur/world-baseline.json` pins what `buildCity()` generates from
 * it. Neither covers the lane graph built by `src/ai/routes.ts#getLaneGraph()`.
 *
 * That was a real blind spot for Phase 1: the lane layer is *derived* from
 * segment geometry, so a geometry change reaches traffic **before** it reaches
 * any authored field. A lane regression would have been invisible until it
 * surfaced as odd NPC behaviour on a device.
 *
 * `getLaneGraph()` is a pure function of `ROAD_SEGMENTS` + `GRAPH_NODES` (no
 * Three.js, no DOM, no RNG), so it can be snapshotted directly in Node.
 *
 * What is pinned
 * --------------
 * Per lane: identity, direction, both endpoints, tangent, yaw, length, road
 * width, kind, signal attachment, and — most importantly — `nextLaneIds`, the
 * junction-adjacency topology. That topology is what a careless "split the
 * segment into spans" change would silently corrupt.
 *
 * Deliberate non-goals
 * --------------------
 * No timestamps, no map iteration order, no Three.js types. Both the lane list
 * and each `nextLaneIds` array are sorted before hashing so the digest is
 * order-independent and identical across runs.
 */

import type { LaneEdge, LaneGraph } from '../src/ai/routes';

/** Coordinate/yaw precision. 1e-6 world units = ~3 microns: far below any
 *  meaningful tolerance, but stable against float re-association. */
const PRECISION = 6;

const round = (n: number, d = PRECISION): number => {
  const f = 10 ** d;
  // `+ 0` normalises -0 to 0 so it cannot perturb the digest.
  return Math.round(n * f) / f + 0;
};

/** One lane, normalised for comparison. */
export interface LaneRecord {
  id: string;
  segmentId: string;
  fromNode: string;
  toNode: string;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  ux: number;
  uz: number;
  yaw: number;
  length: number;
  halfRoadWidth: number;
  kind: string;
  jamProne: boolean;
  toSignal: boolean;
  signalNodeId: string | null;
  nextLaneIds: string[];
}

export interface LaneGraphSnapshot {
  laneCount: number;
  segmentCount: number;
  /** Lane count per gameplay segment. Two is the current invariant. */
  lanesBySegment: Record<string, number>;
  /** Sorted by lane id, so the payload is deterministic. */
  lanes: LaneRecord[];
}

function toRecord(lane: LaneEdge): LaneRecord {
  return {
    id: lane.id,
    segmentId: lane.segmentId,
    fromNode: lane.fromNode,
    toNode: lane.toNode,
    ax: round(lane.ax),
    az: round(lane.az),
    bx: round(lane.bx),
    bz: round(lane.bz),
    ux: round(lane.ux),
    uz: round(lane.uz),
    yaw: round(lane.yaw),
    length: round(lane.length),
    halfRoadWidth: round(lane.halfRoadWidth),
    kind: lane.kind,
    jamProne: lane.jamProne,
    toSignal: lane.toSignal,
    signalNodeId: lane.signalNodeId,
    nextLaneIds: [...lane.nextLaneIds].sort(),
  };
}

/** Stable fingerprint of a single lane, including its junction adjacency. */
export function laneFingerprint(lane: LaneRecord): string {
  return [
    lane.id,
    lane.segmentId,
    `${lane.fromNode}->${lane.toNode}`,
    `${lane.ax},${lane.az},${lane.bx},${lane.bz}`,
    `${lane.ux},${lane.uz},${lane.yaw}`,
    `len=${lane.length}`,
    `hw=${lane.halfRoadWidth}`,
    lane.kind,
    `jam=${lane.jamProne ? 1 : 0}`,
    `sig=${lane.toSignal ? 1 : 0}:${lane.signalNodeId ?? '-'}`,
    `next=${lane.nextLaneIds.join(',')}`,
  ].join('|');
}

/**
 * Order-independent digest over the whole lane set.
 *
 * FNV-1a over the sorted fingerprint list, matching the convention already used
 * by `worldDigest()`. Any change to a lane's geometry, length, direction or
 * outgoing-lane topology changes the digest.
 *
 * The list is sorted *here*, not merely by `buildLaneGraphSnapshot`, so the
 * digest depends only on the lane set and cannot be perturbed by a caller that
 * hands over a differently ordered array.
 */
export function laneDigest(snapshot: LaneGraphSnapshot): string {
  const payload = snapshot.lanes
    .map(laneFingerprint)
    .sort()
    .join('\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Build the comparable snapshot from a real lane graph. Pure. */
export function buildLaneGraphSnapshot(graph: LaneGraph): LaneGraphSnapshot {
  const lanes = graph.lanes.map(toRecord).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const lanesBySegment: Record<string, number> = {};
  for (const lane of lanes) {
    lanesBySegment[lane.segmentId] = (lanesBySegment[lane.segmentId] ?? 0) + 1;
  }

  return {
    laneCount: lanes.length,
    segmentCount: Object.keys(lanesBySegment).length,
    lanesBySegment,
    lanes,
  };
}
