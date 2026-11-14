/**
 * Reproducible Mohammadpur road-coverage audit.
 *
 * Decision A of the 2026-10-29 mission requires that every published coverage
 * number be reproducible by repository code, with its method stated. This script
 * is that code. It emits a machine-readable report so a claim can be re-derived
 * and diffed, rather than copied out of a document.
 *
 *   npm run audit:roads            # human-readable report
 *   npm run audit:roads -- --json  # machine-readable
 *
 * ## Method (every line of it is load-bearing)
 *
 * - **Projection.** `projectOsm()` from `src/world/landmarks.ts` —
 *   origin (23.7624 N, 90.3646 E), scale 0.36 world units per metre, i.e.
 *   1 world unit = 2.7778 m. Identical to `projectLatLon()` in `units.ts`.
 * - **Bounding box.** The playable box is the axis-aligned bounding box of the
 *   *junction nodes* of the runtime road graph, in world units. Roads are
 *   clipped to it; nothing is measured outside it.
 * - **Clipping.** Liang–Barsky per polyline edge. Each OSM edge is clipped
 *   independently and the surviving length is summed. Clipping matters: summing
 *   whole ways that merely touch the box overcounts by 5.5x (260.3 km vs
 *   47.4 km) because a way's full length is counted once any of it is inside.
 * - **Classifications.** Only ways with the dataset's own `driveable` flag
 *   (`true`) are included; the dataset derives that from the OSM `highway` tag
 *   (motorway/trunk/primary/secondary/tertiary/residential/service/
 *   living_street/unclassified and their `_link` variants). Footways, paths,
 *   steps and pedestrian ways are excluded from every length figure.
 * - **Distances.** True point-to-segment distance to a polyline (projection
 *   clamped to each edge), never vertex-to-vertex. Reported in **real metres**.
 * - **Stations.** "Segment midpoint" means the midpoint of the runtime segment's
 *   *chord* (the junction-to-junction line), not its written polyline arc. This
 *   is stated because the two differ on curved segments.
 * - **Units.** Lengths are printed in world units and real metres; the ratio is
 *   exactly 1 / 0.36 = 2.7778.
 *
 * ## Numbers this is expected to produce
 *
 * Pinned by `tests/unit/road-coverage-audit.test.ts` so drift is loud:
 *   in-box drivable length 47,422 m; runtime graph 15,337 m; coverage 32.3 %.
 *   Segment midpoints to nearest drivable road: median 12.2 m, 57/70 within 25 m.
 * If those tests fail, either the map changed (update deliberately) or this
 * method changed (do not let the two drift apart).
 */

import { projectOsm } from '../src/world/landmarks';
import { GRAPH_NODES, ROAD_SEGMENTS } from '../src/world/layout';
import { METERS_PER_WORLD_UNIT } from '../src/world/units';

interface Pt {
  x: number;
  z: number;
}

interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Liang–Barsky edge clip. Returns the clipped edge length, or 0 when outside. */
export function clipEdgeLength(px: number, pz: number, qx: number, qz: number, box: Box): number {
  let t0 = 0;
  let t1 = 1;
  const dx = qx - px;
  const dz = qz - pz;
  const p = [-dx, dx, -dz, dz];
  const q = [px - box.x0, box.x1 - px, pz - box.z0, box.z1 - pz];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return 0;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return 0;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return 0;
      if (r < t1) t1 = r;
    }
  }
  return Math.hypot(dx, dz) * (t1 - t0);
}

/** True distance from a point to a polyline, clamping each edge projection. */
export function distanceToPolyline(px: number, pz: number, pts: readonly Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const vx = b.x - a.x;
    const vz = b.z - a.z;
    const len2 = vx * vx + vz * vz;
    let t = len2 === 0 ? 0 : ((px - a.x) * vx + (pz - a.z) * vz) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const d = Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
    if (d < best) best = d;
  }
  return best;
}

export function playableBox(): Box {
  const xs = ROAD_SEGMENTS.flatMap((s) => [s.ax, s.bx]);
  const zs = ROAD_SEGMENTS.flatMap((s) => [s.az, s.bz]);
  return {
    x0: Math.min(...xs),
    x1: Math.max(...xs),
    z0: Math.min(...zs),
    z1: Math.max(...zs),
  };
}

export interface OsmWay {
  id: number;
  highway?: string;
  driveable?: boolean;
  geometry?: { lat: number; lon: number }[];
}

export interface CoverageReport {
  generatedAt: string;
  method: string;
  dataset: { path: string; sha256: string; bytes: number; origin: unknown; bounds: unknown };
  projection: { lat0: number; lon0: number; scale: number; metresPerWorldUnit: number };
  box: { worldUnits: Box; metres: Box };
  osm: {
    totalWays: number;
    drivableWays: number;
    drivableLengthInBoxWorld: number;
    drivableLengthInBoxMetres: number;
    classificationNote: string;
  };
  graph: {
    nodes: number;
    segments: number;
    lengthWorld: number;
    lengthMetres: number;
    segmentsCitingOsmWay: number;
    syntheticSegments: number;
    syntheticShareOfLength: number;
  };
  coveragePercent: number;
  distances: {
    station: string;
    toNearestDrivableOsmRoadMetres: {
      min: number;
      p25: number;
      median: number;
      p75: number;
      p90: number;
      max: number;
      within25m: number;
      within50m: number;
      sampleCount: number;
    };
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.floor((sorted.length - 1) * p)];
}

export interface AuditInputs {
  /** Raw `roads` array from the OSM extract. */
  roads: OsmWay[];
  /** Dataset metadata passed through unchanged. */
  datasetMeta: { origin?: unknown; bounds?: unknown };
  /** Provenance of the extract, supplied by the caller (which can hash it). */
  datasetInfo: { path: string; sha256: string; bytes: number };
  generatedAt: string;
}

/**
 * Pure coverage computation. No file system, no hashing, no `process`, so the
 * browser tsconfig can type-check the tests that exercise it; the CLI wrapper in
 * `scripts/audit-road-coverage.ts` supplies the bytes and the digest.
 */
export function auditRoadCoverage(input: AuditInputs): CoverageReport {
  const { roads: ways, datasetMeta, datasetInfo, generatedAt } = input;

  const box = playableBox();
  const drivable = ways.filter((w) => w.driveable === true && (w.geometry?.length ?? 0) >= 2);

  const polylines: Pt[][] = [];
  let drivableLength = 0;
  for (const w of drivable) {
    const pts = w.geometry!.map((g) => projectOsm(g.lat, g.lon));
    polylines.push(pts);
    for (let i = 0; i < pts.length - 1; i++) {
      drivableLength += clipEdgeLength(pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z, box);
    }
  }

  let graphLength = 0;
  let syntheticLength = 0;
  for (const s of ROAD_SEGMENTS) {
    graphLength += s.length;
    if (s.osmWayId == null) syntheticLength += s.length;
  }

  // Midpoint of each runtime segment's CHORD (see the method note above).
  const dists: number[] = [];
  for (const s of ROAD_SEGMENTS) {
    const mx = (s.ax + s.bx) / 2;
    const mz = (s.az + s.bz) / 2;
    let best = Infinity;
    for (const pl of polylines) {
      const d = distanceToPolyline(mx, mz, pl);
      if (d < best) best = d;
    }
    dists.push(best * METERS_PER_WORLD_UNIT);
  }
  dists.sort((a, b) => a - b);

  const m = (v: number) => v * METERS_PER_WORLD_UNIT;

  return {
    generatedAt,
    method:
      'Liang-Barsky box clipping per OSM polyline edge; driveable-only; true point-to-segment ' +
      'distance to the nearest drivable polyline sampled at runtime segment chord midpoints; ' +
      'world units converted by exactly 1/0.36.',
    dataset: {
      path: datasetInfo.path,
      sha256: datasetInfo.sha256,
      bytes: datasetInfo.bytes,
      origin: datasetMeta.origin,
      bounds: datasetMeta.bounds,
    },
    projection: { lat0: 23.7624, lon0: 90.3646, scale: 0.36, metresPerWorldUnit: METERS_PER_WORLD_UNIT },
    box: {
      worldUnits: box,
      metres: { x0: m(box.x0), x1: m(box.x1), z0: m(box.z0), z1: m(box.z1) },
    },
    osm: {
      totalWays: ways.length,
      drivableWays: drivable.length,
      drivableLengthInBoxWorld: drivableLength,
      drivableLengthInBoxMetres: m(drivableLength),
      classificationNote:
        'Included: dataset driveable=true (OSM highway classes trunk/primary/secondary/tertiary/' +
        'residential/service/living_street/unclassified + _link). Excluded: footway, path, steps, pedestrian.',
    },
    graph: {
      nodes: GRAPH_NODES.length,
      segments: ROAD_SEGMENTS.length,
      lengthWorld: graphLength,
      lengthMetres: m(graphLength),
      segmentsCitingOsmWay: ROAD_SEGMENTS.filter((s) => s.osmWayId != null).length,
      syntheticSegments: ROAD_SEGMENTS.filter((s) => s.osmWayId == null).length,
      syntheticShareOfLength: (syntheticLength / graphLength) * 100,
    },
    coveragePercent: (graphLength / drivableLength) * 100,
    distances: {
      station: 'runtime segment chord midpoint',
      toNearestDrivableOsmRoadMetres: {
        min: dists[0],
        p25: percentile(dists, 0.25),
        median: percentile(dists, 0.5),
        p75: percentile(dists, 0.75),
        p90: percentile(dists, 0.9),
        max: dists[dists.length - 1],
        within25m: dists.filter((d) => d <= 25).length,
        within50m: dists.filter((d) => d <= 50).length,
        sampleCount: dists.length,
      },
    },
  };
}
