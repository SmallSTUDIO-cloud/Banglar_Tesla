/**
 * Pins the published road-coverage figures to the code that produces them.
 *
 * Decision A of the 2026-10-29 mission: the numbers in the `mohammadpurData.ts`
 * header and in `docs/MOHAMMADPUR_GEOGRAPHIC_AUDIT.md` must be reproducible by a
 * repository script, not copied out of a document, and must fail loudly if the
 * map or the audit method drifts away from them.
 *
 * These are **not** baseline assertions. The golden baselines (845 buildings /
 * `c60e15b5`, 140 lanes / `52306cb0`) govern world output; this file governs
 * *published claims*. If a map change legitimately moves a number here, update
 * the constant and the prose together, deliberately.
 *
 * The computation lives in `tools/roadCoverage.ts` (no Node APIs) so this test
 * can import it under the browser tsconfig. `scripts/audit-road-coverage.ts` is
 * the CLI that adds file IO and the dataset digest.
 */

import { describe, expect, it } from 'vitest';
import dataset from '../../data/mohammadpur/mohammadpur.osm.json';
import {
  auditRoadCoverage,
  clipEdgeLength,
  distanceToPolyline,
  playableBox,
  type OsmWay,
} from '../../tools/roadCoverage';

const report = auditRoadCoverage({
  roads: (dataset as { roads?: OsmWay[] }).roads ?? [],
  datasetMeta: {},
  // The CLI supplies the real digest; these tests exercise geometry, not IO.
  datasetInfo: { path: 'data/mohammadpur/mohammadpur.osm.json', sha256: 'a'.repeat(64), bytes: 0 },
  generatedAt: 'test',
});

describe('road coverage audit — geometry helpers', () => {
  const box = { x0: 0, x1: 10, z0: 0, z1: 10 };

  it('clips an edge fully inside the box to its full length', () => {
    expect(clipEdgeLength(2, 5, 8, 5, box)).toBeCloseTo(6, 10);
  });

  it('clips an edge that exits the box instead of counting the whole way', () => {
    // From x=5 to x=25 inside a 0..10 box: only 5 units of it are in the box.
    expect(clipEdgeLength(5, 5, 25, 5, box)).toBeCloseTo(5, 10);
  });

  it('returns zero for an edge entirely outside the box', () => {
    expect(clipEdgeLength(-5, -5, -20, -20, box)).toBe(0);
    expect(clipEdgeLength(20, 20, 40, 40, box)).toBe(0);
  });

  it('measures point-to-segment distance, not point-to-vertex', () => {
    const line = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ];
    expect(distanceToPolyline(5, 5, line)).toBeCloseTo(5, 10);
    // A vertex-only implementation would report 5 here; the true distance is 0.
    expect(distanceToPolyline(5, 0, line)).toBeLessThan(0.0001);
  });

  it('clamps projection to the segment rather than extending it', () => {
    const line = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ];
    expect(distanceToPolyline(20, 0, line)).toBeCloseTo(10, 10);
    expect(distanceToPolyline(-10, 0, line)).toBeCloseTo(10, 10);
  });
});

describe('road coverage audit — published figures', () => {
  it('reports the playable box actually used by the graph', () => {
    const box = playableBox();
    expect(box.x0).toBe(-218);
    expect(box.x1).toBe(242);
    expect(box.z0).toBe(-256);
    expect(box.z1).toBe(248);
  });

  it('reproduces the in-box drivable length the documents quote', () => {
    // 47.4 km, box-clipped. Summing unclipped ways would give 260 km.
    expect(report.osm.drivableLengthInBoxMetres).toBeGreaterThan(46_000);
    expect(report.osm.drivableLengthInBoxMetres).toBeLessThan(49_000);
  });

  it('reproduces the runtime graph length', () => {
    expect(report.graph.lengthMetres).toBeCloseTo(15_337, -2);
  });

  it('reproduces ~32 % network coverage', () => {
    expect(report.coveragePercent).toBeCloseTo(32.3, 1);
  });

  it('reproduces the synthetic-connector share', () => {
    expect(report.graph.syntheticSegments).toBe(21);
    expect(report.graph.segmentsCitingOsmWay).toBe(49);
    expect(report.graph.syntheticShareOfLength).toBeCloseTo(32.0, 1);
  });

  it('reproduces the corridor-accuracy distribution (median 12.2 m)', () => {
    const d = report.distances.toNearestDrivableOsmRoadMetres;
    expect(d.median).toBeCloseTo(12.2, 1);
    expect(d.within25m).toBe(57);
    expect(d.max).toBeLessThan(60);
  });

  it('states its method rather than leaving it implicit', () => {
    expect(report.method).toMatch(/Liang-Barsky/);
    expect(report.method).toMatch(/point-to-segment/);
  });

  it('is a pure function of its inputs, so the CLI cannot diverge from it', () => {
    const again = auditRoadCoverage({
      roads: (dataset as { roads?: OsmWay[] }).roads ?? [],
      datasetMeta: {},
      datasetInfo: { path: 'x', sha256: 'b'.repeat(64), bytes: 0 },
      generatedAt: 'other',
    });
    expect(again.coveragePercent).toBe(report.coveragePercent);
    expect(again.graph.segments).toBe(report.graph.segments);
    expect(again.distances.toNearestDrivableOsmRoadMetres.median).toBe(
      report.distances.toNearestDrivableOsmRoadMetres.median,
    );
  });
});
