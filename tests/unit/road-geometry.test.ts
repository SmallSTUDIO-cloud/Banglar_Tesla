import { describe, expect, it } from 'vitest';
import { GRAPH_NODES, ROAD_SEGMENTS, nodeById, segmentById } from '../../src/world/layout';
import {
  MAX_JOINT_TURN_DEG,
  arcLengthOf,
  deriveSpans,
  maxJointTurnDeg,
  offsetPoint,
  polylineVertices,
  poseAt,
  projectOntoPolyline,
  renderStrips,
  spansOf,
  tangentAt,
  type SegmentGeometry,
  type Vec2,
} from '../../src/world/roadGeometry';

/**
 * Phase 1 polyline prototype — geometry contract.
 *
 * The prototype gives exactly one segment (`asad_4`) a **collinear** centreline.
 * That makes two claims testable at once:
 *
 * 1. the derivation is correct (spans tile the polyline, arc length is the sum of
 *    spans, junction endpoints are exact); and
 * 2. migrating a consumer to `offsetPoint` is a **provable no-op**, because for
 *    collinear geometry it reproduces the legacy `ax + ux*t + leftX*d` formula.
 *
 * Claim 2 is what makes the eventual curved migration reviewable one call site at
 * a time, so it is asserted across *every* segment, not just `asad_4`.
 */

/** Legacy chord formula, kept here as the reference implementation to match. */
function legacyPoint(seg: SegmentGeometry, t: number, lateral: number): Vec2 {
  return {
    x: seg.ax + seg.ux * t + seg.leftX * lateral,
    z: seg.az + seg.uz * t + seg.leftZ * lateral,
  };
}

function makeSynthetic(vertices: Vec2[]): SegmentGeometry {
  const a = vertices[0];
  const b = vertices[vertices.length - 1];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  const ux = dx / length;
  const uz = dz / length;
  return { ax: a.x, az: a.z, bx: b.x, bz: b.z, length, ux, uz, leftX: uz, leftZ: -ux, vertices };
}

describe('polyline vertices', () => {
  it('falls back to the two chord endpoints when a segment has no vertices', () => {
    const seg = segmentById('ring_0')!;
    expect(seg.vertices).toBeUndefined();
    const pts = polylineVertices(seg);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toEqual({ x: seg.ax, z: seg.az });
    expect(pts[1]).toEqual({ x: seg.bx, z: seg.bz });
  });

  it('gives asad_4 exactly three collinear vertices at 0 %, 50 % and 100 %', () => {
    const seg = segmentById('asad_4')!;
    expect(seg.vertices, 'asad_4 must carry the prototype vertices').toBeDefined();
    const pts = polylineVertices(seg);
    expect(pts).toHaveLength(3);

    // Endpoints are the junction nodes, exactly — no rounding step allowed.
    expect(pts[0].x).toBe(seg.ax);
    expect(pts[0].z).toBe(seg.az);
    expect(pts[2].x).toBe(seg.bx);
    expect(pts[2].z).toBe(seg.bz);

    // The interior vertex is the chord midpoint and lies on the chord line.
    expect(pts[1].x).toBeCloseTo((seg.ax + seg.bx) * 0.5, 12);
    expect(pts[1].z).toBeCloseTo((seg.az + seg.bz) * 0.5, 12);
    expect(pts[1].x * seg.ux + pts[1].z * seg.uz).toBeCloseTo(
      seg.ax * seg.ux + seg.az * seg.uz + seg.length * 0.5,
      12,
    );
  });

  it('de-duplicates repeated vertices instead of emitting a zero-length span', () => {
    const seg = makeSynthetic([
      { x: 0, z: 0 },
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 0 },
    ]);
    expect(polylineVertices(seg)).toEqual([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
    ]);
    expect(deriveSpans(seg)).toHaveLength(1);
  });
});

describe('span derivation', () => {
  it('yields one span per segment without vertices', () => {
    for (const seg of ROAD_SEGMENTS) {
      if (seg.vertices) continue;
      const spans = deriveSpans(seg);
      expect(spans, seg.id).toHaveLength(1);
      expect(spans[0].s0, seg.id).toBe(0);
      expect(spans[0].length, seg.id).toBeCloseTo(seg.length, 9);
    }
  });

  it('splits asad_4 into two half-length spans', () => {
    const seg = segmentById('asad_4')!;
    const spans = deriveSpans(seg);
    expect(spans).toHaveLength(2);
    expect(spans[0].length).toBeCloseTo(seg.length / 2, 9);
    expect(spans[1].length).toBeCloseTo(seg.length / 2, 9);
    // Contiguous arc positions, dense 0-based indices.
    expect(spans[0].s0).toBe(0);
    expect(spans[0].s1).toBeCloseTo(spans[1].s0, 12);
    expect(spans[1].s1).toBeCloseTo(seg.length, 9);
    expect(spans.map((s) => s.index)).toEqual([0, 1]);
  });

  it('keeps spans contiguous and dense for every segment', () => {
    for (const seg of ROAD_SEGMENTS) {
      const spans = deriveSpans(seg);
      expect(spans.length, seg.id).toBeGreaterThan(0);
      expect(spans[0].ax, seg.id).toBeCloseTo(seg.ax, 9);
      expect(spans[0].az, seg.id).toBeCloseTo(seg.az, 9);
      const last = spans[spans.length - 1];
      expect(last.bx, seg.id).toBeCloseTo(seg.bx, 9);
      expect(last.bz, seg.id).toBeCloseTo(seg.bz, 9);
      for (let i = 0; i < spans.length; i++) {
        expect(spans[i].index, seg.id).toBe(i);
        expect(spans[i].s1 - spans[i].s0, seg.id).toBeCloseTo(spans[i].length, 9);
        if (i > 0) expect(spans[i].s0, seg.id).toBeCloseTo(spans[i - 1].s1, 12);
      }
    }
  });

  it('derives the left normal as (uz, -ux) and the right normal as its negation', () => {
    for (const seg of ROAD_SEGMENTS) {
      for (const span of deriveSpans(seg)) {
        expect(span.leftX).toBe(span.uz);
        expect(span.leftZ).toBe(-span.ux);
        // Right-hand normal is simply -left; no separate rightX/rightZ field.
        expect(-span.leftX).toBeCloseTo(-span.uz, 12);
        expect(-span.leftZ).toBeCloseTo(span.ux, 12);
        expect(Math.hypot(span.ux, span.uz)).toBeCloseTo(1, 12);
      }
    }
  });

  it('is deterministic and memoised by segment identity', () => {
    const seg = segmentById('asad_4')!;
    expect(spansOf(seg)).toBe(spansOf(seg)); // same cached array
    expect(JSON.stringify(deriveSpans(seg))).toBe(JSON.stringify(deriveSpans(seg)));
  });

  it('maps authored vertices to spans 1:1 and never invents geometry', () => {
    // A sharp authored corner is reported, not smoothed. An auto-resampler would
    // cut the corner, relocate a road someone verified against real data, and
    // silently shorten arc length. Smoothing must come from authored vertices.
    const corner: Vec2[] = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
    ];
    const seg = makeSynthetic(corner);
    const spans = deriveSpans(seg);

    expect(spans).toHaveLength(2);
    for (const span of spans) {
      expect(corner.some((v) => v.x === span.ax && v.z === span.az)).toBe(true);
      expect(corner.some((v) => v.x === span.bx && v.z === span.bz)).toBe(true);
    }
    // Exactly the authored path: 10 + 10, no corner cutting.
    expect(arcLengthOf(seg)).toBeCloseTo(20, 12);
    expect(maxJointTurnDeg(seg)).toBeCloseTo(90, 9);
  });

  it('reports the worst joint against the heading-change budget', () => {
    const corner = makeSynthetic([
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
    ]);
    expect(maxJointTurnDeg(corner)).toBeGreaterThan(MAX_JOINT_TURN_DEG);

    // A chord has no joints at all.
    for (const seg of ROAD_SEGMENTS) {
      if (seg.vertices) continue;
      expect(maxJointTurnDeg(seg), seg.id).toBe(0);
    }
  });

  it('keeps the collinear prototype within budget, as collinearity implies', () => {
    const seg = segmentById('asad_4')!;
    // Every authored vertex lies on the chord, so every joint turns 0°.
    expect(maxJointTurnDeg(seg)).toBeCloseTo(0, 9);
  });

  it('keeps every real segment inside the heading budget', () => {
    // Currently trivial (only asad_4 has vertices, and it is collinear), but this
    // is the guard that must stay green when verified curved geometry lands.
    for (const seg of ROAD_SEGMENTS) {
      expect(maxJointTurnDeg(seg), seg.id).toBeLessThanOrEqual(MAX_JOINT_TURN_DEG);
    }
  });
});

describe('arc length is distinct from chord length', () => {
  it('exposes both, and they agree for straight and collinear geometry', () => {
    for (const seg of ROAD_SEGMENTS) {
      // `seg.length` is the chord. `arcLengthOf` is the drivable polyline.
      expect(arcLengthOf(seg), seg.id).toBeCloseTo(seg.length, 9);
    }
  });

  it('differs from the chord once the centreline is genuinely curved', () => {
    // Guard against the two ever being conflated: a curved centreline must make
    // arc length strictly longer than the chord it replaced.
    const seg = makeSynthetic([
      { x: 0, z: 0 },
      { x: 5, z: 5 },
      { x: 10, z: 0 },
    ]);
    expect(seg.length).toBeCloseTo(10, 9);
    expect(arcLengthOf(seg)).toBeCloseTo(Math.hypot(5, 5) * 2, 9);
    expect(arcLengthOf(seg)).toBeGreaterThan(seg.length + 3);
    // Nothing was smoothed away: the authored path is exactly what is measured.
    expect(deriveSpans(seg)).toHaveLength(2);
  });

  it('never rewrites seg.length when vertices are present', () => {
    const seg = segmentById('asad_4')!;
    // The authored chord is untouched by the subdivision.
    const n0 = nodeById(seg.from)!;
    const n1 = nodeById(seg.to)!;
    expect(seg.length).toBeCloseTo(Math.hypot(n1.x - n0.x, n1.z - n0.z), 9);
  });
});

describe('backward compatibility of legacy consumers', () => {
  it('reproduces ax + ux*t + leftX*d exactly on every segment', () => {
    // This is the whole migration argument: `offsetPoint` is a drop-in for the
    // 214 existing `ax + ux*t` / `leftX*d` sites, so each can move over
    // individually with no behavioural change.
    for (const seg of ROAD_SEGMENTS) {
      for (const frac of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const t = seg.length * frac;
        for (const lateral of [-seg.halfWidth, -2.5, 0, 1.7, seg.halfWidth]) {
          const got = offsetPoint(seg, t, lateral);
          const want = legacyPoint(seg, t, lateral);
          expect(got.x, `${seg.id} t=${frac} d=${lateral}`).toBeCloseTo(want.x, 9);
          expect(got.z, `${seg.id} t=${frac} d=${lateral}`).toBeCloseTo(want.z, 9);
        }
      }
    }
  });

  it('keeps the tangent constant along a straight segment', () => {
    for (const seg of ROAD_SEGMENTS) {
      if (seg.vertices) continue;
      for (const frac of [0, 0.5, 1]) {
        const pose = poseAt(seg, seg.length * frac);
        expect(pose.ux, seg.id).toBeCloseTo(seg.ux, 12);
        expect(pose.uz, seg.id).toBeCloseTo(seg.uz, 12);
      }
    }
  });

  it('clamps out-of-range arc positions to the segment instead of extrapolating', () => {
    const seg = segmentById('asad_4')!;
    expect(poseAt(seg, -50).x).toBeCloseTo(seg.ax, 9);
    expect(poseAt(seg, seg.length + 50).x).toBeCloseTo(seg.bx, 9);
  });

  it('projects points onto the polyline identically to the chord for straight segments', () => {
    for (const seg of ROAD_SEGMENTS) {
      if (seg.vertices) continue;
      for (const frac of [0.1, 0.37, 0.62, 0.94]) {
        const p = offsetPoint(seg, seg.length * frac, 3.2);
        const proj = projectOntoPolyline(seg, p.x, p.z);
        expect(proj.s, seg.id).toBeCloseTo(seg.length * frac, 6);
        expect(proj.lateral, seg.id).toBeCloseTo(3.2, 6);
        expect(proj.spanIndex, seg.id).toBe(0);
      }
    }
  });

  it('projects a point on asad_4 across the span boundary without jumping', () => {
    const seg = segmentById('asad_4')!;
    // Just before, exactly at, and just after the interior vertex.
    for (const s of [seg.length * 0.49, seg.length * 0.5, seg.length * 0.51]) {
      const p = offsetPoint(seg, s, 2);
      const proj = projectOntoPolyline(seg, p.x, p.z);
      expect(proj.s).toBeCloseTo(s, 6);
      expect(proj.lateral).toBeCloseTo(2, 6);
    }
  });
});

describe('junction identity is preserved', () => {
  it('keeps every segment endpoint equal to its junction node', () => {
    for (const seg of ROAD_SEGMENTS) {
      const a = nodeById(seg.from)!;
      const b = nodeById(seg.to)!;
      expect(seg.ax, seg.id).toBe(a.x);
      expect(seg.az, seg.id).toBe(a.z);
      expect(seg.bx, seg.id).toBe(b.x);
      expect(seg.bz, seg.id).toBe(b.z);
      // And the polyline cannot disagree with the junctions it is pinned to.
      const pts = polylineVertices(seg);
      expect(pts[0].x, seg.id).toBe(a.x);
      expect(pts[0].z, seg.id).toBe(a.z);
      expect(pts[pts.length - 1].x, seg.id).toBe(b.x);
      expect(pts[pts.length - 1].z, seg.id).toBe(b.z);
    }
  });

  it('does not introduce new gameplay segments or junction nodes', () => {
    expect(ROAD_SEGMENTS).toHaveLength(70);
    expect(GRAPH_NODES).toHaveLength(42);
    // Only the approved prototype segment carries vertices.
    const subdivided = ROAD_SEGMENTS.filter((s) => s.vertices).map((s) => s.id);
    expect(subdivided).toEqual(['asad_4']);
  });

  it('keeps interior vertices out of the node graph', () => {
    const seg = segmentById('asad_4')!;
    const interior = polylineVertices(seg).slice(1, -1);
    expect(interior).toHaveLength(1);
    for (const node of GRAPH_NODES) {
      expect(node.x === interior[0].x && node.z === interior[0].z).toBe(false);
    }
  });
});

describe('tangentAt', () => {
  it('matches poseAt across every span boundary', () => {
    for (const seg of ROAD_SEGMENTS) {
      const spans = deriveSpans(seg);
      for (const span of spans) {
        for (const s of [span.s0, (span.s0 + span.s1) / 2, span.s1]) {
          const t = tangentAt(seg, s);
          const pose = poseAt(seg, s);
          expect(t.ux, seg.id).toBeCloseTo(pose.ux, 12);
          expect(t.uz, seg.id).toBeCloseTo(pose.uz, 12);
        }
      }
    }
  });
});

describe('render strips tile the carriageway without a seam', () => {
  /**
   * The asphalt ribbon is drawn as one centred box per span. Splitting a segment
   * therefore splits the surface, and the only way that stays invisible is if the
   * strips tile the original footprint **exactly** — abutting edge-to-edge, with
   * no gap (which would show the ground through the road) and no overlap (which
   * would z-fight and shimmer at the joint).
   *
   * This is asserted mathematically rather than from a screenshot, so it holds
   * regardless of renderer, anti-aliasing or camera.
   */
  const footprint = (seg: SegmentGeometry) => {
    const strips = renderStrips(seg);
    return strips.map((span) => ({
      // The renderer builds a box centred on the span midpoint.
      cx: (span.ax + span.bx) / 2,
      cz: (span.az + span.bz) / 2,
      depth: span.length,
      yaw: Math.atan2(span.ux, span.uz),
      s0: span.s0,
      s1: span.s1,
    }));
  };

  it('is two strips for asad_4, and one for every other segment', () => {
    for (const seg of ROAD_SEGMENTS) {
      expect(renderStrips(seg).length, seg.id).toBe(seg.id === 'asad_4' ? 2 : 1);
    }
  });

  it('shares every joint exactly, so there is no gap and no overlap', () => {
    const seg = segmentById('asad_4')!;
    const boxes = footprint(seg);
    for (let i = 1; i < boxes.length; i++) {
      // Exact equality, not toBeCloseTo: a fractional gap would be a visible slit.
      expect(boxes[i].s0).toBe(boxes[i - 1].s1);
    }
  });

  it('reproduces the original single-box footprint exactly', () => {
    const seg = segmentById('asad_4')!;
    const boxes = footprint(seg);

    // Total depth along the road is unchanged...
    expect(boxes.reduce((sum, b) => sum + b.depth, 0)).toBeCloseTo(seg.length, 12);
    // ...every strip has the original width and heading, so the ribbon cannot
    // twist or widen at the joint...
    const chordYaw = Math.atan2(seg.ux, seg.uz);
    for (const box of boxes) expect(box.yaw).toBeCloseTo(chordYaw, 12);
    // ...and the strips span exactly [0, length].
    expect(boxes[0].s0).toBe(0);
    expect(boxes[boxes.length - 1].s1).toBeCloseTo(seg.length, 12);

    // Area is conserved: sum of strip areas equals the original box area.
    const stripArea = boxes.reduce((sum, b) => sum + b.depth * seg.width, 0);
    expect(stripArea).toBeCloseTo(seg.length * seg.width, 9);

    // The union of the two centre-lines covers the chord with no hole: the far
    // edge of each strip coincides with the near edge of the next, laterally too.
    for (const box of boxes) {
      const proj = projectOntoPolyline(seg, box.cx, box.cz);
      expect(proj.lateral).toBeCloseTo(0, 9); // each centre sits on the centreline
    }
  });

  it('keeps every strip inside the segment bounds', () => {
    for (const seg of ROAD_SEGMENTS) {
      for (const span of renderStrips(seg)) {
        expect(span.s0, seg.id).toBeGreaterThanOrEqual(0);
        expect(span.s1, seg.id).toBeLessThanOrEqual(arcLengthOf(seg) + 1e-9);
      }
    }
  });
});

describe('minimap road polyline', () => {
  /**
   * The minimap draws one `moveTo` from `(ax,az)` then a `lineTo` per strip
   * endpoint. For a straight segment that is the previous two-point line; for the
   * collinear prototype it is a three-point line whose intermediate point lies on
   * the same chord, so the drawn road is unchanged.
   */
  it('draws a two-point line for straight segments and a collinear three-point line for asad_4', () => {
    for (const seg of ROAD_SEGMENTS) {
      const points = [
        { x: seg.ax, z: seg.az },
        ...renderStrips(seg).map((s) => ({ x: s.bx, z: s.bz })),
      ];
      if (!seg.vertices) {
        expect(points, seg.id).toHaveLength(2);
        continue;
      }
      expect(points, seg.id).toHaveLength(3);
      // Collinear: the cross product of consecutive edges vanishes.
      for (let i = 1; i < points.length - 1; i++) {
        const ax = points[i].x - points[i - 1].x;
        const az = points[i].z - points[i - 1].z;
        const bx = points[i + 1].x - points[i].x;
        const bz = points[i + 1].z - points[i].z;
        expect(Math.abs(ax * bz - az * bx), seg.id).toBeLessThan(1e-9);
      }
    }
  });
});

/* ========================================================================== *
 * P2 — curve-aware projection layer
 * ========================================================================== */

import { ROAD_SEGMENTS as SEGMENTS, snapToNearestRoad } from '../../src/world/layout';
import { nearestOf } from '../../src/world/roadGeometry';

/** The pre-P2 chord implementation, kept verbatim as the equivalence reference. */
function legacySnap(x: number, z: number, allowGali = true) {
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  let bestSeg = SEGMENTS[0];
  let bestDist = Infinity;
  let bestX = x;
  let bestZ = z;
  for (const s of SEGMENTS) {
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
  const laneOffset = Math.min(1.6, bestSeg.halfWidth * 0.42);
  return {
    x: bestX + bestSeg.leftX * laneOffset,
    z: bestZ + bestSeg.leftZ * laneOffset,
    yaw: Math.atan2(bestSeg.ux, bestSeg.uz),
    segmentId: bestSeg.id,
  };
}

describe('P2 snapToNearestRoad is a provable no-op on the current graph', () => {
  it('matches the legacy chord implementation across a world-space grid', () => {
    let compared = 0;
    let worstDist = 0;
    for (let x = -300; x <= 340; x += 9.5) {
      for (let z = -190; z <= 250; z += 9.5) {
        const got = snapToNearestRoad(x, z);
        const want = legacySnap(x, z, true);
        expect(got.segment.id, `segment at (${x}, ${z})`).toBe(want.segmentId);
        const d = Math.hypot(got.x - want.x, got.z - want.z);
        worstDist = Math.max(worstDist, d);
        expect(d, `position at (${x}, ${z})`).toBeLessThan(1e-9);
        expect(Math.abs(got.yaw - want.yaw), `yaw at (${x}, ${z})`).toBeLessThan(1e-9);
        compared++;
      }
    }
    // Guard against a vacuous pass: the grid must actually have been walked.
    // (-300..340 step 9.5) x (-190..250 step 9.5) = 68 x 47 = 3196 points.
    expect(compared).toBe(3196);
    expect(worstDist).toBeLessThan(1e-9);
  });

  it('matches the legacy implementation with gali excluded', () => {
    let compared = 0;
    for (let x = -260; x <= 320; x += 17) {
      for (let z = -150; z <= 220; z += 17) {
        const got = snapToNearestRoad(x, z, false);
        const want = legacySnap(x, z, false);
        expect(got.segment.id, `(${x}, ${z})`).toBe(want.segmentId);
        expect(Math.hypot(got.x - want.x, got.z - want.z), `(${x}, ${z})`).toBeLessThan(1e-9);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(600);
  });

  it('settles on a point clear of both junction ends', () => {
    for (const seg of SEGMENTS) {
      for (const frac of [0.05, 0.3, 0.5, 0.8, 0.97]) {
        const p = offsetPoint(seg, arcLengthOf(seg) * frac, 0);
        const snap = snapToNearestRoad(p.x, p.z);
        const margin = Math.min(4, seg.length * 0.2);
        const proj = projectOntoPolyline(snap.segment, p.x, p.z);
        if (snap.segment.id !== seg.id) continue; // nearer neighbour wins
        const clamped = projectOntoPolyline(snap.segment, snap.x, snap.z);
        expect(clamped.s, seg.id).toBeGreaterThanOrEqual(margin - 1e-6);
        expect(clamped.s, seg.id).toBeLessThanOrEqual(
          arcLengthOf(seg) - margin + 1e-6 + 1.6,
        );
        expect(proj.s).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('P2 curved geometry: chord projection fails, polyline projection holds', () => {
  /**
   * A synthetic 90° corner with a 20-unit arm length, deliberately sharp. On the
   * *inside* of the bend a point is far closer to the polyline than the chord, so
   * a chord projection both mis-measures the distance and picks the wrong segment.
   */
  const corner = makeSynthetic([
    { x: 0, z: 0 },
    { x: 20, z: 0 },
    { x: 20, z: 20 },
  ]);

  it('measures distance to the true road, not the chord', () => {
    // A point just inside the corner, 2 units from each arm.
    const x = 18;
    const z = 2;
    const poly = projectOntoPolyline(corner, x, z);
    const trueDist = Math.hypot(x - poly.x, z - poly.z);

    // Chord distance: project onto the straight line (0,0)->(20,20).
    const ux = corner.ux;
    const uz = corner.uz;
    const t = Math.max(0, Math.min(corner.length, x * ux + z * uz));
    const chordDist = Math.hypot(x - ux * t, z - uz * t);

    // The chord says the point is ~11 units off the road; it is actually ~2.
    expect(chordDist).toBeGreaterThan(10);
    expect(trueDist).toBeCloseTo(2, 6);
    expect(trueDist).toBeLessThan(chordDist / 5);
  });

  it('selects the nearer of two segments it straddles', () => {
    const near = makeSynthetic([
      { x: 0, z: 0 },
      { x: 20, z: 0 },
    ]);
    const far = makeSynthetic([
      { x: 0, z: 10 },
      { x: 20, z: 10 },
    ]);
    const snap = nearestOf([near, far], 10, 3, { marginOf: () => 0 });
    expect(snap).not.toBeNull();
    expect(snap!.segment).toBe(near);
    // Left normal for (ux,uz)=(1,0) is (uz,-ux)=(0,-1), i.e. it points toward -z.
    // So a query point at +z lies on the RIGHT of the direction of travel.
    expect(snap!.lateral).toBeCloseTo(-3, 9);
  });

  it('never returns a point off the polyline', () => {
    const segs = [corner];
    for (let x = -6; x <= 26; x += 2) {
      for (let z = -6; z <= 26; z += 2) {
        const snap = nearestOf(segs, x, z, { marginOf: () => 0 })!;
        const re = projectOntoPolyline(corner, snap.pose.x, snap.pose.z);
        // The reported pose lies on the centreline.
        expect(Math.hypot(snap.pose.x - re.x, snap.pose.z - re.z)).toBeLessThan(1e-9);
        // And it is the true closest point.
        const direct = projectOntoPolyline(corner, x, z);
        expect(snap.dist).toBeCloseTo(Math.hypot(x - direct.x, z - direct.z), 9);
      }
    }
  });

  it('reports the local tangent, not the chord tangent, at the corner', () => {
    // (18,10) is 2 units from the second arm but 10 from the first, so the
    // winner is unambiguous. (18,2) would be an exact tie — both arms are 2 away
    // — which is why it is not used here.
    const snap = nearestOf([corner], 18, 10, { marginOf: () => 0 })!;
    // Closest point is on the second arm, whose tangent points +z.
    expect(snap.pose.ux).toBeCloseTo(0, 9);
    expect(snap.pose.uz).toBeCloseTo(1, 9);
    // The chord tangent points diagonally (+x, +z), which would be wrong here.
    expect(Math.abs(corner.ux - 0)).toBeGreaterThan(0.5);
  });

  it('clamps to the margin on a curved segment using arc length', () => {
    const snap = nearestOf([corner], 20, 19, { marginOf: () => 4 })!;
    // arc length 40, so the arc position must be <= 36.
    expect(snap.s).toBeLessThanOrEqual(36 + 1e-9);
    expect(snap.s).toBeGreaterThanOrEqual(4 - 1e-9);
  });
});
