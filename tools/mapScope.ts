/**
 * Mohammadpur map-scope measurement.
 *
 * ## Why this exists
 *
 * The older audit (`tools/roadCoverage.ts`) measures OSM road stock inside the
 * **bounding rectangle** of the current game graph. That rectangle is not an
 * administrative boundary — it is just the extent of 70 hand-authored segments.
 * It happens to be much smaller than the thana, so dividing the graph length by
 * the in-box OSM length **overstates** coverage:
 *
 *   in-box  box 1.789 km²  -> 15,337 / 47,422 = 32.3 %
 *   in-scope ring 3.541 km² -> 15,337 / 93,625 = 16.4 %
 *
 * This module clips against the documented boundary polygon instead, which is
 * the honest denominator for "how much of Mohammadpur have we built".
 *
 * ## The boundary is provisional — read this before quoting any number
 *
 * The polygon is OSM way **318722840** (`boundary=administrative`,
 * `admin_level=8`, `source=Open Cities Dhaka Survey`). It measures **3.541 km²**,
 * while published areas for Mohammadpur Thana range from **7.44 km²** (BBS 2022
 * census, as reported by Prothom Alo) to **11.65 km²** (older Wikipedia/Wikidata).
 * The polygon is therefore *smaller than the administrative thana* by a factor of
 * 2–3 and must not be presented as full-thana coverage. See
 * `docs/MOHAMMADPUR_MAP_SCOPE.md` for the full reconciliation.
 *
 * Every number this module produces is "inside OSM way 318722840", not "inside
 * Mohammadpur Thana". Those are different claims.
 *
 * ## Clipping is exact, not sampled
 *
 * Splitting an edge at every intersection with the ring means each resulting
 * sub-segment lies wholly inside or wholly outside the ring, so testing one
 * midpoint per sub-segment is exact rather than an approximation of the crossing
 * position. No step size, no tolerance to tune, and the result is independent of
 * vertex ordering density.
 *
 * Pure functions only — no `node:fs`, no hashing — so `tests/unit` can import
 * this under the browser tsconfig. `scripts/audit-map-scope.ts` supplies bytes.
 */

import { METERS_PER_WORLD_UNIT } from '../src/world/units';

export interface Pt {
  x: number;
  z: number;
}

/** Closed ring in world units: the last point repeats the first. */
export type Ring = readonly Pt[];

export interface ScopeWay {
  id: number;
  highway?: string;
  driveable?: boolean;
  /** Projected geometry in world units, in source order. */
  polyline: readonly Pt[];
  nameEn?: string;
}

/**
 * Signed area of a closed ring in world units², positive when counter-clockwise.
 * Requires `ring[0]` and `ring[ring.length - 1]` to be the same point.
 */
export function ringSignedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i].x * ring[i + 1].z - ring[i + 1].x * ring[i].z;
  }
  return a / 2;
}

/** Area of a closed ring converted to square kilometres. */
export function ringAreaKm2(ring: Ring): number {
  return (Math.abs(ringSignedArea(ring)) * METERS_PER_WORLD_UNIT ** 2) / 1e6;
}

/** Perimeter of a closed ring in metres. */
export function ringPerimeterMetres(ring: Ring): number {
  let p = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    p += Math.hypot(ring[i + 1].x - ring[i].x, ring[i + 1].z - ring[i].z);
  }
  return p * METERS_PER_WORLD_UNIT;
}

/**
 * Ray-casting point-in-ring test.
 *
 * A point exactly on the boundary is not guaranteed either way — callers that
 * care about that should treat boundary points as their own case. Every number
 * reported here aggregates thousands of sub-segments, so a handful of
 * exact-on-edge samples cannot move a figure at the precision we quote.
 */
export function pointInRing(ring: Ring, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    if (a.z > z !== b.z > z) {
      const xCross = a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z);
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

/**
 * Parameters along `p -> q` where the segment meets the ring, in (0, 1).
 * Endpoints are excluded so a shared vertex is not counted twice.
 */
function ringCrossings(ring: Ring, p: Pt, q: Pt): number[] {
  const ts: number[] = [];
  const rx = q.x - p.x;
  const rz = q.z - p.z;
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    const sx = b.x - a.x;
    const sz = b.z - a.z;
    const denom = rx * sz - rz * sx;
    if (denom === 0) continue; // parallel or collinear: no isolated crossing
    const t = ((a.x - p.x) * sz - (a.z - p.z) * sx) / denom;
    const u = ((a.x - p.x) * rz - (a.z - p.z) * rx) / denom;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  return ts;
}

/**
 * Length of one polyline that lies inside the ring, in world units.
 *
 * Exact: each edge is split at its crossings, giving sub-segments that are
 * wholly in or wholly out, then one midpoint decides each.
 */
export function clipPolylineToRing(polyline: readonly Pt[], ring: Ring): number {
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const p = polyline[i];
    const q = polyline[i + 1];
    const cuts = [0, ...ringCrossings(ring, p, q).sort((m, n) => m - n), 1];
    for (let k = 0; k < cuts.length - 1; k++) {
      const t0 = cuts[k];
      const t1 = cuts[k + 1];
      if (t1 - t0 <= 0) continue;
      const mx = p.x + (q.x - p.x) * ((t0 + t1) / 2);
      const mz = p.z + (q.z - p.z) * ((t0 + t1) / 2);
      if (!pointInRing(ring, mx, mz)) continue;
      total += Math.hypot(q.x - p.x, q.z - p.z) * (t1 - t0);
    }
  }
  return total;
}

/** Full polyline length, ignoring the ring. */
export function polylineLength(polyline: readonly Pt[]): number {
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    total += Math.hypot(polyline[i + 1].x - polyline[i].x, polyline[i + 1].z - polyline[i].z);
  }
  return total;
}

export interface GraphSegment {
  id: string;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  length: number;
}

export interface MapScopeInputs {
  /** Closed boundary ring in world units. */
  ring: Ring;
  /** Every drivable OSM way, already projected to world units. */
  ways: readonly ScopeWay[];
  /** Runtime game-graph segments. */
  graphSegments: readonly GraphSegment[];
  /** Provenance recorded verbatim in the report. */
  boundarySource: {
    osmWayId: number;
    version?: number;
    retrievedAt?: string;
    datasetSha256?: string;
    license: string;
  };
  generatedAt: string;
}

export interface CorridorLine {
  name: string;
  ways: number;
  totalMetres: number;
  inScopeMetres: number;
  /** Ways that cross the ring: part in, part out. */
  crossingWays: number;
}

export interface MapScopeReport {
  generatedAt: string;
  method: string;
  boundary: {
    osmWayId: number;
    version?: number;
    retrievedAt?: string;
    datasetSha256?: string;
    license: string;
    vertices: number;
    areaKm2: number;
    perimeterMetres: number;
    /** Published thana areas for comparison — the polygon is not the whole thana. */
    publishedThanaAreaKm2: { value: number; source: string }[];
    provisional: boolean;
    provisionalReason: string;
  };
  osm: {
    drivableWays: number;
    waysTouchingScope: number;
    totalDrivableMetres: number;
    inScopeMetres: number;
  };
  graph: {
    segments: number;
    lengthMetres: number;
    inScopeMetres: number;
    segmentsInScope: number;
    /** Graph segments whose midpoint falls outside the ring. */
    segmentsOutside: string[];
  };
  coverage: {
    graphOverInScopeOsmPercent: number;
    /** The figure the older box-based audit reported, for contrast. */
    note: string;
  };
  corridors: CorridorLine[];
}

/** Corridor names worth breaking out because roadmap decisions depend on them. */
const CORRIDOR_MATCHERS: { name: string; match: (n: string) => boolean }[] = [
  { name: 'Mirpur Road', match: (n) => n.includes('mirpur road') },
  { name: 'Sher-E-Bangla Road', match: (n) => n.includes('sher-e-bangla') || n.includes('sher e bangla') },
  { name: 'Aurangzeb Road', match: (n) => n.includes('aurangzeb') },
  { name: 'Asad Avenue', match: (n) => n.includes('asad avenue') },
  { name: 'Ring Road', match: (n) => n.includes('ring road') },
  { name: 'Tajmahal Road', match: (n) => n.includes('tajmahal') },
  { name: 'Satmasjid Road', match: (n) => n.includes('satmasjid') },
  { name: 'Beribadh Road', match: (n) => n.includes('beribadh') },
];

/**
 * Full scope audit. Deterministic in every field except `generatedAt`, which the
 * caller supplies so tests can pin it.
 */
export function auditMapScope(input: MapScopeInputs): MapScopeReport {
  const { ring, ways, graphSegments, boundarySource, generatedAt } = input;

  const drivable = ways.filter((w) => w.driveable === true && w.polyline.length >= 2);

  let totalDrivable = 0;
  let inScope = 0;
  let touching = 0;
  for (const w of drivable) {
    const full = polylineLength(w.polyline);
    const inside = clipPolylineToRing(w.polyline, ring);
    totalDrivable += full;
    inScope += inside;
    if (inside > 0) touching++;
  }

  let graphLength = 0;
  let graphInScope = 0;
  let segmentsInScope = 0;
  const segmentsOutside: string[] = [];
  for (const s of graphSegments) {
    graphLength += s.length;
    const mx = (s.ax + s.bx) / 2;
    const mz = (s.az + s.bz) / 2;
    if (pointInRing(ring, mx, mz)) {
      graphInScope += s.length;
      segmentsInScope++;
    } else {
      segmentsOutside.push(s.id);
    }
  }

  const corridors: CorridorLine[] = CORRIDOR_MATCHERS.map(({ name, match }) => {
    // Match on the projected name only. An empty string must not fall through to
    // the highway tag: that would attribute unnamed ways to a named corridor.
    const group = drivable.filter((w) => match((w.nameEn ?? '').toLowerCase()));
    let total = 0;
    let inside = 0;
    let crossing = 0;
    for (const w of group) {
      const full = polylineLength(w.polyline);
      const inRing = clipPolylineToRing(w.polyline, ring);
      total += full;
      inside += inRing;
      if (inRing > 0 && inRing < full) crossing++;
    }
    return {
      name,
      ways: group.length,
      totalMetres: total * METERS_PER_WORLD_UNIT,
      inScopeMetres: inside * METERS_PER_WORLD_UNIT,
      crossingWays: crossing,
    };
  }).filter((c) => c.ways > 0);

  const graphMetres = graphLength * METERS_PER_WORLD_UNIT;
  const inScopeMetres = inScope * METERS_PER_WORLD_UNIT;

  return {
    generatedAt,
    method:
      'OSM drivable polyline length clipped to the closed boundary ring by splitting each ' +
      'edge at every ring crossing (exact, unsampled). All figures are inside the ring only.',
    boundary: {
      ...boundarySource,
      vertices: ring.length,
      areaKm2: ringAreaKm2(ring),
      perimeterMetres: ringPerimeterMetres(ring),
      publishedThanaAreaKm2: [
        { value: 7.44, source: 'BBS 2022 census, reported by Prothom Alo' },
        { value: 8.23, source: 'Wikipedia, Mohammadpur Thana' },
        { value: 11.65, source: 'Wikidata Q3347514 / older Wikipedia' },
      ],
      provisional: true,
      provisionalReason:
        'The OSM admin_level=8 polygon covers 3.54 km2, while every published thana area ' +
        'is 7.44 km2 or larger. It is the mapped core of Mohammadpur, not the whole thana, ' +
        'so figures here are "inside the mapped boundary", never "full thana coverage".',
    },
    osm: {
      drivableWays: drivable.length,
      waysTouchingScope: touching,
      totalDrivableMetres: totalDrivable * METERS_PER_WORLD_UNIT,
      inScopeMetres,
    },
    graph: {
      segments: graphSegments.length,
      lengthMetres: graphMetres,
      inScopeMetres: graphInScope * METERS_PER_WORLD_UNIT,
      segmentsInScope,
      segmentsOutside,
    },
    coverage: {
      graphOverInScopeOsmPercent: inScopeMetres > 0 ? (graphMetres / inScopeMetres) * 100 : 0,
      note:
        'The box-based audit divides by OSM length inside the graph bounding rectangle ' +
        '(1.789 km2) and therefore reports a larger percentage than the in-boundary figure here.',
    },
    corridors,
  };
}
