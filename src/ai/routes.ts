/**
 * Connected left-hand-drive lane graph built directly from the Mohammadpur
 * OpenStreetMap street segments in `src/world/layout.ts`.
 *
 * Unlike static closed loops, NPC vehicles traverse individual directed street
 * lanes (`LaneEdge`) and dynamically pick outgoing lanes at every Mohammadpur
 * junction (with smooth quadratic Bezier turn arcs at corners and clean U-turn
 * bulbs at genuine cul-de-sac dead ends).
 */

import { GRAPH_NODES, ROAD_SEGMENTS, nodeById, type RoadSegment } from '../world/layout';

export interface LanePoint {
  x: number;
  z: number;
  yaw: number;
}

export interface LaneEdge {
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
  kind: RoadSegment['kind'];
  jamProne: boolean;
  /** Outgoing lane IDs reachable from `toNode`. */
  nextLaneIds: string[];
  /** True if `toNode` is a signalised intersection. */
  toSignal: boolean;
  signalNodeId: string | null;
}

export interface LaneGraph {
  lanes: LaneEdge[];
  byId: Map<string, LaneEdge>;
  bySegment: Map<string, LaneEdge[]>;
}

let cachedGraph: LaneGraph | null = null;

export function getLaneGraph(): LaneGraph {
  if (cachedGraph) return cachedGraph;

  const lanes: LaneEdge[] = [];
  const byId = new Map<string, LaneEdge>();
  const bySegment = new Map<string, LaneEdge[]>();
  const outgoingFromNode = new Map<string, LaneEdge[]>();

  for (const n of GRAPH_NODES) {
    outgoingFromNode.set(n.id, []);
  }

  for (const seg of ROAD_SEGMENTS) {
    // Bangladesh left-hand traffic offset from road centreline
    const laneOffset =
      seg.kind === 'main' ? seg.halfWidth * 0.46 : seg.kind === 'medium' ? seg.halfWidth * 0.44 : seg.halfWidth * 0.38;

    const dirs: { suffix: string; from: string; to: string; sign: 1 | -1 }[] = [
      { suffix: 'fwd', from: seg.from, to: seg.to, sign: 1 },
      { suffix: 'rev', from: seg.to, to: seg.from, sign: -1 },
    ];

    for (const d of dirs) {
      const nFrom = nodeById(d.from)!;
      const nTo = nodeById(d.to)!;
      const ux = seg.ux * d.sign;
      const uz = seg.uz * d.sign;
      // Left-hand vector for direction (ux, uz) is (uz, -ux)
      const lx = uz;
      const lz = -ux;

      const ax = nFrom.x + lx * laneOffset;
      const az = nFrom.z + lz * laneOffset;
      const bx = nTo.x + lx * laneOffset;
      const bz = nTo.z + lz * laneOffset;
      const length = Math.max(1, Math.hypot(bx - ax, bz - az));

      const edge: LaneEdge = {
        id: `${seg.id}:${d.suffix}`,
        segmentId: seg.id,
        fromNode: d.from,
        toNode: d.to,
        ax,
        az,
        bx,
        bz,
        ux: (bx - ax) / length,
        uz: (bz - az) / length,
        yaw: Math.atan2(bx - ax, bz - az),
        length,
        halfRoadWidth: seg.halfWidth,
        kind: seg.kind,
        jamProne: seg.jamProne,
        nextLaneIds: [],
        toSignal: nTo.signal,
        signalNodeId: nTo.signal ? nTo.id : null,
      };

      lanes.push(edge);
      byId.set(edge.id, edge);
      outgoingFromNode.get(d.from)!.push(edge);
      if (!bySegment.has(seg.id)) bySegment.set(seg.id, []);
      bySegment.get(seg.id)!.push(edge);
    }
  }

  // Link outgoing lanes at every node (preferring non-U-turn continuations unless at a cul-de-sac!)
  for (const lane of lanes) {
    const candidates = outgoingFromNode.get(lane.toNode) ?? [];
    const nonUTurn = candidates.filter((c) => c.toNode !== lane.fromNode);
    lane.nextLaneIds = (nonUTurn.length > 0 ? nonUTurn : candidates).map((c) => c.id);
  }

  cachedGraph = { lanes, byId, bySegment };
  return cachedGraph;
}

/** Sample world `(x, z, yaw)` along a directed `LaneEdge` at distance `s` in `[0, length]`. */
export function sampleLane(lane: LaneEdge, s: number, lateralNudge: number, out: LanePoint): LanePoint {
  const lx = lane.uz;
  const lz = -lane.ux;
  out.x = lane.ax + lane.ux * s + lx * lateralNudge;
  out.z = lane.az + lane.uz * s + lz * lateralNudge;
  out.yaw = lane.yaw;
  return out;
}

export interface TrafficRouteLoop {
  id: string;
  points: { x: number; z: number }[];
  length: number;
}

/** Build deterministic closed left-hand route loops across Mohammadpur for route tests. */
export function buildTrafficRoutes(): TrafficRouteLoop[] {
  const graph = getLaneGraph();
  const seeds = [0, Math.floor(graph.lanes.length / 3), Math.floor((graph.lanes.length * 2) / 3)];
  return seeds.map((startIdx, idx) => {
    const pts: { x: number; z: number }[] = [];
    let cur = graph.lanes[startIdx % graph.lanes.length];
    let length = 0;
    for (let step = 0; step < 12; step++) {
      pts.push({ x: cur.ax, z: cur.az });
      length += cur.length;
      const nextId = cur.nextLaneIds[step % Math.max(1, cur.nextLaneIds.length)];
      cur = (nextId ? graph.byId.get(nextId) : undefined) ?? cur;
    }
    pts.push({ ...pts[0] });
    return { id: `loop-${idx}`, points: pts, length };
  });
}

export function sampleRoute(route: TrafficRouteLoop, dist: number, out: LanePoint): LanePoint {
  const pts = route.points;
  if (pts.length < 2) {
    out.x = pts[0]?.x ?? 0;
    out.z = pts[0]?.z ?? 0;
    out.yaw = 0;
    return out;
  }
  let total = 0;
  const segLens: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z);
    segLens.push(l);
    total += l;
  }
  if (total <= 1e-5) {
    out.x = pts[0].x;
    out.z = pts[0].z;
    out.yaw = 0;
    return out;
  }
  let d = ((dist % total) + total) % total;
  for (let i = 0; i < segLens.length; i++) {
    const l = segLens[i];
    if (d <= l || i === segLens.length - 1) {
      const t = l > 1e-5 ? d / l : 0;
      const dx = pts[i + 1].x - pts[i].x;
      const dz = pts[i + 1].z - pts[i].z;
      out.x = pts[i].x + dx * t;
      out.z = pts[i].z + dz * t;
      out.yaw = Math.atan2(dx, dz);
      return out;
    }
    d -= l;
  }
  return out;
}
