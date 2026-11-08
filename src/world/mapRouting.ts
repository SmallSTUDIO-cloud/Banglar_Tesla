/**
 * Map routing over the *live* gameplay road graph.
 *
 * Deliberately contains no coordinates of its own: everything is derived from
 * `ROAD_SEGMENTS` / `GRAPH_NODES` in `src/world/layout.ts`, which is the same
 * graph the traffic AI, missions and the player drive on. A destination is only
 * routable when the graph can actually reach it, so the map cannot draw a route
 * the rickshaw could not follow.
 *
 * When a corridor is migrated to real OSM geometry, connectivity and routes
 * update automatically — nothing here needs editing.
 */

import { GRAPH_NODES, ROAD_SEGMENTS, type RoadSegment } from '../world/layout';
import type { Poi } from '../world/poiRegistry';

/** How far a place may sit from the carriageway and still be considered served. */
export const POI_ROAD_MAX_OFFSET_M = 45;

export interface NearestRoad {
  segment: RoadSegment;
  /** Perpendicular distance from the query point to the carriageway. */
  distance: number;
  /** Point on the carriageway closest to the query point. */
  x: number;
  z: number;
}

export interface MapPoint {
  x: number;
  z: number;
}

export interface RouteResult {
  /** Polyline from the player to the destination, following real segments. */
  points: MapPoint[];
  /** Total length in metres, including the connection spurs. */
  distance: number;
  segmentIds: string[];
}

/** Closest point on any segment to (x, z). */
export function nearestRoad(x: number, z: number): NearestRoad | null {
  let best: NearestRoad | null = null;
  for (const segment of ROAD_SEGMENTS) {
    const vx = segment.bx - segment.ax;
    const vz = segment.bz - segment.az;
    const len2 = vx * vx + vz * vz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - segment.ax) * vx + (z - segment.az) * vz) / len2));
    const px = segment.ax + t * vx;
    const pz = segment.az + t * vz;
    const distance = Math.hypot(x - px, z - pz);
    if (!best || distance < best.distance) best = { segment, distance, x: px, z: pz };
  }
  return best;
}

export type PoiReach =
  | { routable: true; road: NearestRoad }
  | { routable: false; reason: 'outside-world' | 'no-road-nearby'; distance: number };

/**
 * Whether a POI can currently receive a route.
 *
 * `outside-world` is a hard no: the feature is real but lies beyond the playable
 * extent, so the player cannot drive there. `no-road-nearby` means the graph has
 * not been migrated to that area yet.
 */
export function poiReach(poi: Poi): PoiReach {
  if (!poi.insideWorld) return { routable: false, reason: 'outside-world', distance: Infinity };
  const road = nearestRoad(poi.x, poi.z);
  if (!road || road.distance > POI_ROAD_MAX_OFFSET_M) {
    return { routable: false, reason: 'no-road-nearby', distance: road?.distance ?? Infinity };
  }
  return { routable: true, road };
}

interface Edge {
  to: string;
  segmentId: string;
  length: number;
}

const adjacency = ((): Map<string, Edge[]> => {
  const map = new Map<string, Edge[]>();
  for (const node of GRAPH_NODES) map.set(node.id, []);
  for (const segment of ROAD_SEGMENTS) {
    const a = map.get(segment.from);
    const b = map.get(segment.to);
    if (!a || !b) continue;
    a.push({ to: segment.to, segmentId: segment.id, length: segment.length });
    b.push({ to: segment.from, segmentId: segment.id, length: segment.length });
  }
  return map;
})();

/** True when every node in the graph can reach every other node. */
export const GRAPH_IS_CONNECTED: boolean = (() => {
  if (GRAPH_NODES.length === 0) return false;
  const seen = new Set<string>([GRAPH_NODES[0].id]);
  const stack = [GRAPH_NODES[0].id];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const edge of adjacency.get(current) ?? []) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        stack.push(edge.to);
      }
    }
  }
  return seen.size === GRAPH_NODES.length;
})();

const nodeMap = new Map(GRAPH_NODES.map((n) => [n.id, n]));

/** Dijkstra over the road graph. Returns node ids, or null when unreachable. */
function shortestNodePath(startId: string, goalId: string): { nodes: string[]; length: number } | null {
  if (!nodeMap.has(startId) || !nodeMap.has(goalId)) return null;
  if (startId === goalId) return { nodes: [startId], length: 0 };

  const dist = new Map<string, number>([[startId, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  // Small graph (42 nodes) — a linear scan is simpler and faster than a heap.
  for (;;) {
    let current: string | null = null;
    let bestDistance = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < bestDistance) {
        bestDistance = d;
        current = id;
      }
    }
    if (current === null) return null;
    if (current === goalId) {
      const nodes = [goalId];
      let cursor = goalId;
      while (prev.has(cursor)) {
        cursor = prev.get(cursor)!;
        nodes.unshift(cursor);
      }
      return { nodes, length: bestDistance };
    }
    done.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      if (done.has(edge.to)) continue;
      const candidate = bestDistance + edge.length;
      if (candidate < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, candidate);
        prev.set(edge.to, current);
      }
    }
  }
}

function closestNode(x: number, z: number): { id: string; x: number; z: number } | null {
  let best: { id: string; x: number; z: number; d: number } | null = null;
  for (const node of GRAPH_NODES) {
    const d = Math.hypot(node.x - x, node.z - z);
    if (!best || d < best.d) best = { id: node.id, x: node.x, z: node.z, d };
  }
  return best ? { id: best.id, x: best.x, z: best.z } : null;
}

/**
 * Route between two free points, snapping to the road graph at both ends.
 *
 * Returns null when either end is unserviceable or the graph cannot connect
 * them. The player is never teleported: the returned polyline starts at the
 * player's actual position and the caller only reads it for guidance.
 */
export function buildRoute(from: MapPoint, to: MapPoint): RouteResult | null {
  const startRoad = nearestRoad(from.x, from.z);
  const endRoad = nearestRoad(to.x, to.z);
  if (!startRoad || !endRoad) return null;

  const startNode = closestNode(startRoad.x, startRoad.z);
  const endNode = closestNode(endRoad.x, endRoad.z);
  if (!startNode || !endNode) return null;

  const path = shortestNodePath(startNode.id, endNode.id);
  if (!path) return null;

  const points: MapPoint[] = [{ x: from.x, z: from.z }];
  const push = (p: MapPoint): void => {
    const last = points[points.length - 1];
    if (Math.hypot(last.x - p.x, last.z - p.z) > 0.05) points.push(p);
  };

  push({ x: startRoad.x, z: startRoad.z });
  for (const id of path.nodes) {
    const node = nodeMap.get(id);
    if (node) push({ x: node.x, z: node.z });
  }
  push({ x: endRoad.x, z: endRoad.z });
  push({ x: to.x, z: to.z });

  let distance = 0;
  for (let i = 1; i < points.length; i += 1) {
    distance += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z);
  }

  const segmentIds: string[] = [];
  for (const edge of adjacency.get(startNode.id) ?? []) segmentIds.push(edge.segmentId);

  return { points, distance, segmentIds };
}

/** Route to a registry POI, or null when the POI is not connected yet. */
export function buildRouteToPoi(from: MapPoint, poi: Poi): RouteResult | null {
  if (!poiReach(poi).routable) return null;
  return buildRoute(from, { x: poi.x, z: poi.z });
}

/** Straight-line distance, used for the HUD readout. */
export function straightDistance(from: MapPoint, to: MapPoint): number {
  return Math.hypot(to.x - from.x, to.z - from.z);
}
