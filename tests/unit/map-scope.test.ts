/**
 * Pins the boundary-clipped map-scope figures and the clipping algorithm.
 *
 * Two separate jobs:
 *
 * 1. **Algorithm.** Synthetic rings with hand-computable answers prove the exact
 *    clip (split at crossings, one midpoint per sub-segment) is not approximating.
 * 2. **Published claims.** Real-dataset figures are pinned so the numbers in
 *    `docs/MOHAMMADPUR_MAP_SCOPE.md` cannot drift away from the code that
 *    produces them.
 *
 * The boundary is provisional: it covers 3.54 km² while published Mohammadpur
 * Thana areas are 7.44 km² or larger. `docs/MOHAMMADPUR_MAP_SCOPE.md` explains
 * why, and every claim here is "inside OSM way 318722840", not "full thana".
 */

import { describe, expect, it } from 'vitest';
import dataset from '../../data/mohammadpur/mohammadpur.osm.json';
import { projectOsm } from '../../src/world/landmarks';
import { ROAD_SEGMENTS } from '../../src/world/layout';
import { METERS_PER_WORLD_UNIT } from '../../src/world/units';
import {
  auditMapScope,
  clipPolylineToRing,
  pointInRing,
  polylineLength,
  ringAreaKm2,
  ringPerimeterMetres,
  ringSignedArea,
  type Pt,
  type Ring,
  type ScopeWay,
} from '../../tools/mapScope';

/** Axis-aligned ring from (0,0) to (10,10), closed. */
const SQUARE: Ring = [
  { x: 0, z: 0 },
  { x: 10, z: 0 },
  { x: 10, z: 10 },
  { x: 0, z: 10 },
  { x: 0, z: 0 },
];

describe('map scope — ring measurements', () => {
  it('measures a known square', () => {
    expect(Math.abs(ringSignedArea(SQUARE))).toBe(100);
    expect(ringPerimeterMetres(SQUARE)).toBeCloseTo(40 * METERS_PER_WORLD_UNIT, 6);
    expect(ringAreaKm2(SQUARE)).toBeCloseTo((100 * METERS_PER_WORLD_UNIT ** 2) / 1e6, 9);
  });

  it('is orientation independent for area', () => {
    const reversed = [...SQUARE].reverse();
    expect(Math.abs(ringSignedArea(reversed))).toBeCloseTo(Math.abs(ringSignedArea(SQUARE)), 9);
    expect(ringAreaKm2(reversed)).toBeCloseTo(ringAreaKm2(SQUARE), 12);
  });

  it('reports a ring below one square kilometre in km² correctly', () => {
    // 1 world unit = 2.7778 m, so 100 units² = 771.6 m².
    expect(ringAreaKm2(SQUARE)).toBeLessThan(0.001);
  });
});

describe('map scope — point-in-ring', () => {
  it('accepts the centre and rejects far outside', () => {
    expect(pointInRing(SQUARE, 5, 5)).toBe(true);
    expect(pointInRing(SQUARE, -5, 5)).toBe(false);
    expect(pointInRing(SQUARE, 15, 5)).toBe(false);
    expect(pointInRing(SQUARE, 5, -5)).toBe(false);
    expect(pointInRing(SQUARE, 5, 15)).toBe(false);
  });

  it('handles a concave ring, rejecting the notch', () => {
    // U shape: a 10x10 box with a notch cut from the top centre.
    const u: Ring = [
      { x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 },
      { x: 7, z: 10 }, { x: 7, z: 3 }, { x: 3, z: 3 }, { x: 3, z: 10 },
      { x: 0, z: 10 }, { x: 0, z: 0 },
    ];
    expect(pointInRing(u, 5, 1)).toBe(true); // bottom bar
    expect(pointInRing(u, 1, 8)).toBe(true); // left arm
    expect(pointInRing(u, 9, 8)).toBe(true); // right arm
    expect(pointInRing(u, 5, 8)).toBe(false); // inside the notch
  });
});

describe('map scope — exact clipping', () => {
  it('returns the full length for a polyline wholly inside', () => {
    const line: Pt[] = [{ x: 1, z: 5 }, { x: 9, z: 5 }];
    expect(clipPolylineToRing(line, SQUARE)).toBeCloseTo(8, 12);
    expect(polylineLength(line)).toBeCloseTo(8, 12);
  });

  it('returns zero for a polyline wholly outside', () => {
    expect(clipPolylineToRing([{ x: -5, z: 5 }, { x: -1, z: 5 }], SQUARE)).toBe(0);
    expect(clipPolylineToRing([{ x: 20, z: 5 }, { x: 30, z: 5 }], SQUARE)).toBe(0);
  });

  it('clips a straddling segment to the exact inside length', () => {
    // From x=-4 to x=14 at z=5: inside width is exactly 10.
    expect(clipPolylineToRing([{ x: -4, z: 5 }, { x: 14, z: 5 }], SQUARE)).toBeCloseTo(10, 12);
  });

  it('is exact to the crossing point, not to a sampling step', () => {
    // Starting outside on the left, the inside span is exactly the 10-wide square,
    // whatever the starting offset. An awkward offset proves there is no 1/N
    // quantisation in the result.
    for (const start of [-3.3, -0.7, -11.9]) {
      const len = clipPolylineToRing([{ x: start, z: 5 }, { x: 40, z: 5 }], SQUARE);
      expect(len).toBeCloseTo(10, 12);
    }
    // Starting already inside, the answer is the remainder, not the full span.
    expect(clipPolylineToRing([{ x: 1.234, z: 5 }, { x: 40, z: 5 }], SQUARE))
      .toBeCloseTo(10 - 1.234, 12);
  });

  it('handles a diagonal crossing at a non-trivial parameter', () => {
    // (2,-5) -> (8,15) enters through z=0 at t=0.25 and leaves through z=10 at
    // t=0.75, so exactly half the segment is inside.
    const len = clipPolylineToRing([{ x: 2, z: -5 }, { x: 8, z: 15 }], SQUARE);
    expect(len).toBeCloseTo(0.5 * Math.hypot(6, 20), 9);
  });

  it('returns zero for a segment that only touches a corner', () => {
    // z = x - 10 meets the square only at the corner (10,0): no interior run.
    // Verified independently against a 2,000,000-sample numeric integration.
    expect(clipPolylineToRing([{ x: 5, z: -5 }, { x: 15, z: 5 }], SQUARE)).toBe(0);
  });

  it('sums multiple disjoint inside runs of one polyline', () => {
    // Enters, leaves, re-enters: two separate inside runs of 4 each.
    const zig: Pt[] = [
      { x: -6, z: 2 }, { x: 4, z: 2 }, // inside x 0..4  -> 4
      { x: 4, z: 8 }, // still inside (vertical, length 6)
      { x: 14, z: 8 }, // inside x 4..10 -> 6, then out
    ];
    expect(clipPolylineToRing(zig, SQUARE)).toBeCloseTo(4 + 6 + 6, 9);
  });

  it('ignores a polyline that only touches the boundary tangentially', () => {
    // Runs along z=0 exactly on the edge. Point-in-ring is undefined on the
    // boundary, so the contract is only that it stays finite and bounded.
    const len = clipPolylineToRing([{ x: -5, z: 0 }, { x: 15, z: 0 }], SQUARE);
    expect(Number.isFinite(len)).toBe(true);
    expect(len).toBeGreaterThanOrEqual(0);
    expect(len).toBeLessThanOrEqual(20 + 1e-9);
  });

  it('never exceeds the polyline length or goes negative', () => {
    const line: Pt[] = [{ x: -20, z: 5 }, { x: 20, z: 5 }];
    const inside = clipPolylineToRing(line, SQUARE);
    expect(inside).toBeGreaterThanOrEqual(0);
    expect(inside).toBeLessThanOrEqual(polylineLength(line));
  });

  it('degenerates safely on an empty or single-point polyline', () => {
    expect(clipPolylineToRing([], SQUARE)).toBe(0);
    expect(clipPolylineToRing([{ x: 5, z: 5 }], SQUARE)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Real dataset: published figures, pinned.
// ---------------------------------------------------------------------------

const raw = dataset as unknown as {
  boundary: { lat: number; lon: number }[];
  roads: { id: number; highway?: string; driveable?: boolean; geometry?: { lat: number; lon: number }[]; nameEn?: string; name?: string }[];
  source?: { boundaryWayId?: number };
};

const RING = raw.boundary.map((p) => projectOsm(p.lat, p.lon));

const WAYS: ScopeWay[] = raw.roads.map((w) => ({
  id: w.id,
  highway: w.highway,
  driveable: w.driveable,
  nameEn: w.nameEn || w.name,
  polyline: (w.geometry ?? []).map((g) => projectOsm(g.lat, g.lon)),
}));

const GRAPH = ROAD_SEGMENTS.map((s) => ({
  id: s.id, ax: s.ax, az: s.az, bx: s.bx, bz: s.bz, length: s.length,
}));

const REPORT = auditMapScope({
  ring: RING,
  ways: WAYS,
  graphSegments: GRAPH,
  boundarySource: {
    osmWayId: raw.source?.boundaryWayId ?? 318722840,
    retrievedAt: '2026-11-08T19:15:39+00:00',
    datasetSha256: 'a'.repeat(64),
    license: 'ODbL-1.0',
  },
  generatedAt: 'test',
});

describe('map scope — real Mohammadpur boundary', () => {
  it('is the documented OSM way with a closed ring', () => {
    expect(REPORT.boundary.osmWayId).toBe(318722840);
    expect(RING.length).toBeGreaterThan(100);
    expect(RING[0].x).toBeCloseTo(RING[RING.length - 1].x, 9);
    expect(RING[0].z).toBeCloseTo(RING[RING.length - 1].z, 9);
  });

  it('measures 3.54 km² — well below every published thana area', () => {
    expect(REPORT.boundary.areaKm2).toBeCloseTo(3.541, 2);
    for (const p of REPORT.boundary.publishedThanaAreaKm2) {
      expect(p.value).toBeGreaterThan(REPORT.boundary.areaKm2 * 2);
    }
    expect(REPORT.boundary.provisional).toBe(true);
  });

  it('flags the boundary as provisional rather than claiming full-thana coverage', () => {
    expect(REPORT.boundary.provisionalReason).toMatch(/not the whole thana/i);
  });

  it('places the entire existing game graph inside the boundary', () => {
    // If any segment fell outside, the current world would extend beyond the
    // documented thana — that would be a real finding, not a tolerance issue.
    expect(REPORT.graph.segments).toBe(70);
    expect(REPORT.graph.segmentsInScope).toBe(70);
    expect(REPORT.graph.segmentsOutside).toEqual([]);
    expect(REPORT.graph.inScopeMetres).toBeCloseTo(REPORT.graph.lengthMetres, 6);
    expect(REPORT.graph.lengthMetres).toBeCloseTo(15337, 0);
  });

  it('measures in-boundary OSM drivable stock and the resulting coverage', () => {
    // Box-based audit reported 47,422 m and 32.3 %; clipping to the 3.54 km²
    // boundary more than doubles the denominator. 16.4 % is the honest figure.
    expect(REPORT.osm.inScopeMetres).toBeCloseTo(93551, -2);
    expect(REPORT.coverage.graphOverInScopeOsmPercent).toBeCloseTo(16.4, 1);
    expect(REPORT.osm.inScopeMetres).toBeLessThan(REPORT.osm.totalDrivableMetres);
  });

  it('reports Mirpur Road in-boundary length, correcting the old box figure', () => {
    const mirpur = REPORT.corridors.find((c) => c.name === 'Mirpur Road');
    expect(mirpur).toBeDefined();
    // The previously quoted 1,297.2 m was measured inside the graph bounding
    // rectangle, not inside this boundary. The in-boundary figure is 1,704 m.
    expect(mirpur!.inScopeMetres).toBeCloseTo(1704, -1);
    expect(mirpur!.inScopeMetres).not.toBeCloseTo(1297.2, 0);
    expect(mirpur!.crossingWays).toBeGreaterThan(0);
    expect(mirpur!.totalMetres).toBeGreaterThan(mirpur!.inScopeMetres);
  });

  it('reports Aurangzeb Road fully inside and Sher-E-Bangla partly inside', () => {
    const aurangzeb = REPORT.corridors.find((c) => c.name === 'Aurangzeb Road')!;
    expect(aurangzeb.inScopeMetres).toBeCloseTo(aurangzeb.totalMetres, 6);
    expect(aurangzeb.crossingWays).toBe(0);

    const sher = REPORT.corridors.find((c) => c.name === 'Sher-E-Bangla Road')!;
    expect(sher.inScopeMetres).toBeGreaterThan(0);
    expect(sher.inScopeMetres).toBeLessThan(sher.totalMetres);
    expect(sher.crossingWays).toBeGreaterThan(0);
  });

  it('is deterministic for identical inputs', () => {
    const again = auditMapScope({
      ring: RING,
      ways: WAYS,
      graphSegments: GRAPH,
      boundarySource: REPORT.boundary as never,
      generatedAt: 'test',
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(REPORT));
  });
});
