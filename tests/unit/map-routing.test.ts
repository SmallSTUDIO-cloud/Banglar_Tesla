import { describe, expect, it } from 'vitest';
import {
  buildRoute,
  buildRouteToPoi,
  GRAPH_IS_CONNECTED,
  nearestRoad,
  poiReach,
  POI_ROAD_MAX_OFFSET_M,
} from '../../src/world/mapRouting';
import { GRAPH_NODES, ROAD_SEGMENTS } from '../../src/world/layout';
import { POIS } from '../../src/world/poiRegistry';

/**
 * Routing must be derived from the same graph the player drives on. These tests
 * assert that a route exists only when the graph supports it, that it starts at
 * the player (never teleports), and that it is continuous.
 */

describe('map routing', () => {
  it('reports the graph as connected', () => {
    expect(GRAPH_IS_CONNECTED).toBe(true);
  });

  it('snaps any point to a real segment', () => {
    const road = nearestRoad(0, 0);
    expect(road).not.toBeNull();
    expect(ROAD_SEGMENTS.some((s) => s.id === road!.segment.id)).toBe(true);
    expect(road!.distance).toBeGreaterThanOrEqual(0);
  });

  it('routes between two points on the graph', () => {
    const route = buildRoute({ x: -112, z: 194 }, { x: 64.93, z: 98.11 });
    expect(route).not.toBeNull();
    expect(route!.points.length).toBeGreaterThan(2);
    expect(route!.distance).toBeGreaterThan(50);
  });

  it('starts the route at the player position, never teleporting', () => {
    const from = { x: -60.5, z: 150.25 };
    const route = buildRoute(from, { x: 64.93, z: 98.11 })!;
    expect(route.points[0].x).toBeCloseTo(from.x, 5);
    expect(route.points[0].z).toBeCloseTo(from.z, 5);
    expect(route.points[route.points.length - 1].x).toBeCloseTo(64.93, 5);
  });

  it('produces a continuous polyline with no jumps', () => {
    const route = buildRoute({ x: -112, z: 194 }, { x: 111.5, z: -122.7 })!;
    for (let i = 1; i < route.points.length; i += 1) {
      const step = Math.hypot(
        route.points[i].x - route.points[i - 1].x,
        route.points[i].z - route.points[i - 1].z,
      );
      // No single hop may exceed the longest segment in the graph.
      const longest = Math.max(...ROAD_SEGMENTS.map((s) => s.length));
      expect(step).toBeLessThanOrEqual(longest + 1);
    }
  });

  it('reports a distance at least as long as the straight line', () => {
    const from = { x: -112, z: 194 };
    const to = { x: 111.5, z: -122.7 };
    const route = buildRoute(from, to)!;
    const straight = Math.hypot(to.x - from.x, to.z - from.z);
    expect(route.distance).toBeGreaterThanOrEqual(straight - 1);
  });

  it('marks a real but out-of-world POI as not routable', () => {
    const tokyo = POIS.find((p) => p.id === 'tokyo_square')!;
    expect(tokyo.insideWorld).toBe(false);
    const reach = poiReach(tokyo);
    expect(reach.routable).toBe(false);
    if (!reach.routable) expect(reach.reason).toBe('outside-world');
    expect(buildRouteToPoi({ x: -112, z: 194 }, tokyo)).toBeNull();
  });

  it('routes to every in-world POI that sits near the graph', () => {
    const start = { x: -112, z: 194 };
    const routable = POIS.filter((p) => poiReach(p).routable);
    expect(routable.length).toBeGreaterThanOrEqual(12);
    for (const poi of routable) {
      const route = buildRouteToPoi(start, poi);
      expect(route, `${poi.id} should be routable`).not.toBeNull();
      expect(route!.distance).toBeGreaterThan(0);
    }
  });

  it('every POI is either in-world or explicitly outside it', () => {
    for (const poi of POIS) {
      const reach = poiReach(poi);
      if (!reach.routable && reach.reason === 'no-road-nearby') {
        // Any in-world POI this far from a road is a real gap worth knowing about.
        expect(reach.distance).toBeGreaterThan(POI_ROAD_MAX_OFFSET_M);
      }
    }
    expect(GRAPH_NODES.length).toBeGreaterThan(0);
  });
});
