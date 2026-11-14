/**
 * Polyline road geometry — Phase 1 prototype.
 *
 * Why this module exists
 * ----------------------
 * Every road shape in the game is currently a *chord*: `RoadSegment` stores only
 * `(ax,az)` and `(bx,bz)`, and 214 call sites reconstruct positions with
 * `ax + ux*t` / `leftX*d`. Those formulas are exact for a straight road and wrong
 * for any curved one, because they use the chord tangent everywhere.
 *
 * This module is the single place where a segment is turned into straight
 * *spans*, and the only sanctioned way to ask "where is the road at distance s".
 * Consumers migrate to `poseAt` / `offsetPoint` / `projectOntoPolyline` and stop
 * doing their own vector algebra.
 *
 * Deliberate design constraints
 * -----------------------------
 * 1. **Chord length is never redefined.** `seg.length` keeps meaning the
 *    straight-line distance between the two junction nodes. Polyline length is a
 *    *separate* query, `arcLengthOf(seg)`. A stored `arcLength` field was
 *    rejected: two stored lengths can drift out of sync, a function cannot. For
 *    a segment with no `vertices` the two are equal by construction, so no
 *    existing distance consumer changes meaning.
 * 2. **A segment with no `vertices` behaves exactly as before.** It yields a
 *    single span whose tangent is the chord tangent, so migrating a call site is
 *    a provable no-op on the 69 unsubdivided segments.
 * 3. **Spans are derived, never authored, and geometry is never invented.**
 *    Spans map 1:1 onto the authored vertices. There is deliberately **no**
 *    auto-resampler that inserts or nudges points to smooth a corner: doing so
 *    would relocate a road that someone verified against real data, and it would
 *    quietly shorten arc length (corner-cutting). If a centreline needs more
 *    vertices to stay smooth, they must be **authored from verified geometry**.
 *    `maxJointTurnDeg` exists so the heading-change budget can be *checked*
 *    rather than silently enforced.
 * 4. **Junction identity is preserved.** `vertices[0]` must equal `(ax,az)` and
 *    the last vertex `(bx,bz)` exactly. Interior vertices are *not* nodes and
 *    never enter the road graph.
 *
 * Units: all coordinates and lengths are **world units** (1 unit = 2.778 m).
 * Widths and sidewalk offsets elsewhere in `src/world` are real metres; this
 * module only deals in positions and distances, which are world units.
 */

/**
 * Heading-change budget for a single interior joint, in degrees.
 *
 * Traffic renders lane heading as a per-lane constant `yaw`, so a polyline joint
 * appears as a discrete heading snap. The measured worst case on real Asad
 * Avenue geometry is 15.17°, which would be visible; 6° is below the threshold
 * where a vehicle's heading reads as a kink at normal following distance.
 *
 * This is a **budget to be validated**, not a resampling target. Keep authored
 * joints inside it by supplying more verified vertices.
 */
export const MAX_JOINT_TURN_DEG = 6;

export interface Vec2 {
  x: number;
  z: number;
}

/**
 * The geometry a segment must expose for derivation.
 *
 * Declared structurally rather than importing `RoadSegment`, so this module has
 * no runtime dependency on the layout graph (and no import cycle).
 */
export interface SegmentGeometry {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Chord length — straight-line between the two junction nodes. */
  length: number;
  ux: number;
  uz: number;
  leftX: number;
  leftZ: number;
  /** Optional authored centreline, including both endpoints. Absent ⇒ a chord. */
  vertices?: readonly Vec2[];
}

/** One straight span of a segment. Derived from `vertices`; never authored. */
export interface RoadSpan {
  /** Dense index within the segment, 0-based. */
  index: number;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit tangent along the span. Constant within the span. */
  ux: number;
  uz: number;
  /** Unit left-hand normal, (uz, -ux) — the existing Dhaka convention. */
  leftX: number;
  leftZ: number;
  /** Straight-line span length in world units. */
  length: number;
  /** Arc position of `(ax,az)` measured from the segment start. */
  s0: number;
  /** Arc position of `(bx,bz)`. `s1 - s0 === length`. */
  s1: number;
}

/** Point plus local frame at an arc position. */
export interface RoadPose {
  x: number;
  z: number;
  ux: number;
  uz: number;
  leftX: number;
  leftZ: number;
  spanIndex: number;
  /** Arc distance from the segment start, clamped to `[0, arcLengthOf(seg)]`. */
  s: number;
}

export interface PolylineProjection {
  /** Arc distance of the closest point, clamped to the segment. */
  s: number;
  /** Signed lateral offset: positive to the left of the (a→b) direction. */
  lateral: number;
  spanIndex: number;
  x: number;
  z: number;
}

/**
 * The ordered vertex list for a segment.
 *
 * Always begins at `(ax,az)` and ends at `(bx,bz)` — the junction nodes are the
 * first and last vertices by definition, so identity cannot drift. Consecutive
 * duplicates are removed, because a zero-length span has no tangent.
 */
export function polylineVertices(seg: SegmentGeometry): Vec2[] {
  const raw = seg.vertices;
  const pts: Vec2[] = [];

  if (raw && raw.length >= 2) {
    for (const v of raw) {
      const prev = pts[pts.length - 1];
      if (prev && prev.x === v.x && prev.z === v.z) continue;
      pts.push({ x: v.x, z: v.z });
    }
    // A degenerate authored list collapses to the chord rather than producing a
    // span with no direction.
    if (pts.length >= 2) return pts;
  }

  return [
    { x: seg.ax, z: seg.az },
    { x: seg.bx, z: seg.bz },
  ];
}

/**
 * Derive the straight spans of a segment. Pure.
 *
 * One span per authored edge — no resampling, no corner cutting, so the derived
 * path is exactly the authored path and arc length is exactly its length.
 *
 * Prefer `spansOf` in hot paths; this recomputes on every call.
 */
export function deriveSpans(seg: SegmentGeometry): RoadSpan[] {
  const pts = polylineVertices(seg);
  const spans: RoadSpan[] = [];
  let s = 0;

  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x;
    const az = pts[i].z;
    const bx = pts[i + 1].x;
    const bz = pts[i + 1].z;
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (!(length > 0)) continue; // defensive: duplicate vertices were already removed

    const ux = dx / length;
    const uz = dz / length;
    spans.push({
      index: spans.length,
      ax,
      az,
      bx,
      bz,
      ux,
      uz,
      leftX: uz,
      leftZ: -ux,
      length,
      s0: s,
      s1: s + length,
    });
    s += length;
  }

  // A segment is never allowed to be span-less: fall back to the chord.
  if (spans.length === 0) {
    const length = Math.max(0.01, seg.length);
    spans.push({
      index: 0,
      ax: seg.ax,
      az: seg.az,
      bx: seg.bx,
      bz: seg.bz,
      ux: seg.ux,
      uz: seg.uz,
      leftX: seg.leftX,
      leftZ: seg.leftZ,
      length,
      s0: 0,
      s1: length,
    });
  }

  return spans;
}

/**
 * Memoised `deriveSpans`.
 *
 * Keyed on the segment *object*, which is a stable singleton in `ROAD_SEGMENTS`.
 * A `WeakMap` rather than a field on the segment so the graph data stays a plain
 * record and a geometry edit cannot leave a stale derived cache in JSON.
 */
const spanCache = new WeakMap<object, RoadSpan[]>();

export function spansOf(seg: SegmentGeometry): readonly RoadSpan[] {
  let spans = spanCache.get(seg as object);
  if (!spans) {
    spans = deriveSpans(seg);
    spanCache.set(seg as object, spans);
  }
  return spans;
}

/**
 * Polyline (arc) length — the drivable distance along the centreline.
 *
 * This is deliberately a **separate query** from `seg.length`, which remains the
 * chord between the two junctions. For a segment with no `vertices` the two are
 * equal.
 */
export function arcLengthOf(seg: SegmentGeometry): number {
  const spans = spansOf(seg);
  return spans[spans.length - 1].s1;
}

/** Largest heading change at any interior joint, in degrees. 0 for a chord. */
export function maxJointTurnDeg(seg: SegmentGeometry): number {
  const spans = spansOf(seg);
  let worst = 0;
  for (let i = 1; i < spans.length; i++) {
    const b0 = Math.atan2(spans[i - 1].ux, spans[i - 1].uz);
    const b1 = Math.atan2(spans[i].ux, spans[i].uz);
    let d = b1 - b0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    worst = Math.max(worst, Math.abs((d * 180) / Math.PI));
  }
  return worst;
}

/** Span containing arc position `s`, clamped to the segment. */
function spanAt(spans: readonly RoadSpan[], s: number): RoadSpan {
  if (!(s > 0)) return spans[0];
  const last = spans[spans.length - 1];
  if (s >= last.s1) return last;
  // Spans are few (1–3 typically), so a linear scan beats a binary search.
  for (let i = 0; i < spans.length; i++) {
    if (s <= spans[i].s1) return spans[i];
  }
  return last;
}

/**
 * Point and local frame at arc distance `s` from the segment start.
 *
 * The frame is piecewise-constant in heading: within a span `ux/uz` is the span
 * chord direction, which is exact, not interpolated.
 *
 * Out-of-range `s` is **clamped** to the nearer endpoint rather than
 * extrapolated, so a caller with a small float overshoot lands on the junction
 * instead of off the end of the road.
 */
export function poseAt(seg: SegmentGeometry, s: number, out?: RoadPose): RoadPose {
  const spans = spansOf(seg);
  const span = spanAt(spans, s);
  // Clamp inside the chosen span as well — selecting the first/last span is not
  // enough, because `t = s - s0` would otherwise be negative or overlong.
  const t = Math.max(0, Math.min(span.length, s - span.s0));
  const pose = out ?? ({} as RoadPose);
  pose.x = span.ax + span.ux * t;
  pose.z = span.az + span.uz * t;
  pose.ux = span.ux;
  pose.uz = span.uz;
  pose.leftX = span.leftX;
  pose.leftZ = span.leftZ;
  pose.spanIndex = span.index;
  pose.s = span.s0 + t;
  return pose;
}

/**
 * World position at arc distance `s`, offset `lateral` to the **left** of the
 * a→b direction (negative moves right).
 *
 * This is the drop-in replacement for `ax + ux*t + leftX*d`. On a straight
 * segment it returns bit-identical values, which is what makes the migration of
 * the 214 existing call sites reviewable one at a time.
 */
export function offsetPoint(seg: SegmentGeometry, s: number, lateral: number): Vec2 {
  const pose = poseAt(seg, s);
  return {
    x: pose.x + pose.leftX * lateral,
    z: pose.z + pose.leftZ * lateral,
  };
}

/** Unit tangent at arc distance `s`. */
export function tangentAt(seg: SegmentGeometry, s: number): { ux: number; uz: number } {
  const span = spanAt(spansOf(seg), s);
  return { ux: span.ux, uz: span.uz };
}

/**
 * Project a world point onto the segment polyline.
 *
 * Unlike the chord projection in `layout.ts`, this cannot snap a point on the
 * inside of a bend onto the wrong part of the road.
 */
export function projectOntoPolyline(
  seg: SegmentGeometry,
  x: number,
  z: number,
): PolylineProjection {
  const spans = spansOf(seg);
  let best: PolylineProjection | null = null;
  let bestDistSq = Infinity;

  for (const span of spans) {
    const dx = x - span.ax;
    const dz = z - span.az;
    const along = dx * span.ux + dz * span.uz;
    const t = Math.max(0, Math.min(span.length, along));
    const px = span.ax + span.ux * t;
    const pz = span.az + span.uz * t;
    const ddx = x - px;
    const ddz = z - pz;
    const distSq = ddx * ddx + ddz * ddz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      // Positive to the left of the a→b direction.
      const lateral = ddx * span.leftX + ddz * span.leftZ;
      best = { s: span.s0 + t, lateral, spanIndex: span.index, x: px, z: pz };
    }
  }

  // Unreachable: `spansOf` guarantees at least one span.
  return best!;
}

/**
 * Asphalt ribbon segments for rendering.
 *
 * Exported so renderers do not need to know how spans are derived.
 */
export function renderStrips(seg: SegmentGeometry): readonly RoadSpan[] {
  return spansOf(seg);
}

/* ------------------------------------------------- nearest-point selection */

/** Result of searching a set of segments for the closest centreline point. */
export interface SegmentSnap<T> {
  segment: T;
  /** Arc position of the closest point, already clamped by `marginOf`. */
  s: number;
  /** Signed lateral offset of the query point from the centreline (left positive). */
  lateral: number;
  /** Frame at `s`, after clamping — use this rather than the segment chord frame. */
  pose: RoadPose;
  /** Straight-line distance from the query point to the clamped centreline point. */
  dist: number;
}

/**
 * Find the segment whose centreline passes closest to `(x, z)`.
 *
 * Extracted from `layout.ts#snapToNearestRoad` so the selection logic can be
 * tested against **synthetic curved geometry**, which cannot be injected into the
 * real road graph. The algorithm is identical to the original:
 *
 *   1. project onto the centreline,
 *   2. clamp the arc position to `[margin, arcLength - margin]` so callers never
 *      snap onto a junction disc,
 *   3. measure the distance to the *clamped* point,
 *   4. keep the closest.
 *
 * The only change is that steps 1 and 3 use the polyline rather than the chord,
 * and the returned frame is the local span frame rather than the chord tangent.
 *
 * `marginOf` is supplied by the caller because the margin is a gameplay concern
 * (junction clearance), not a geometry one.
 */
export function nearestOf<T extends SegmentGeometry>(
  segments: readonly T[],
  x: number,
  z: number,
  opts: {
    marginOf: (segment: T) => number;
    /** Return true to exclude a segment from the search. */
    skip?: (segment: T) => boolean;
  },
): SegmentSnap<T> | null {
  let best: SegmentSnap<T> | null = null;

  for (const segment of segments) {
    if (opts.skip?.(segment)) continue;

    const margin = opts.marginOf(segment);
    const arc = arcLengthOf(segment);
    // Guard the degenerate case where two margins would overlap on a very short
    // segment: prefer the start marker rather than inverting the range.
    const lo = Math.min(margin, arc * 0.5);
    const hi = Math.max(lo, arc - margin);

    const projected = projectOntoPolyline(segment, x, z);
    const s = Math.max(lo, Math.min(hi, projected.s));
    const pose = poseAt(segment, s);
    const dist = Math.hypot(x - pose.x, z - pose.z);

    if (!best || dist < best.dist) {
      best = { segment, s, lateral: projected.lateral, pose, dist };
    }
  }

  return best;
}

/* ------------------------------------------------------- placement frames */

/** Position, orientation and local axes for anything placed relative to a road. */
export interface PlacementFrame {
  x: number;
  z: number;
  /** Unit tangent along the span containing `s`. */
  ux: number;
  uz: number;
  /** Unit left-hand normal, (uz, -ux). */
  leftX: number;
  leftZ: number;
  /** Box rotation that aligns a local +Z axis with the tangent. */
  yaw: number;
  /** Span index, for callers that want to dedupe work per span. */
  spanIndex: number;
  /** Arc position after clamping. */
  s: number;
}

/**
 * Frame for an object placed `lateral` to the left of the centreline at arc
 * distance `s` (negative moves right).
 *
 * This is the replacement for the widespread
 * `seg.ax + seg.ux * t + seg.leftX * d` / `Math.atan2(seg.ux, seg.uz)` pair.
 * On a straight or collinear segment it reproduces both exactly, which is what
 * lets call sites migrate one at a time with no change in output.
 *
 * The important difference on a curve: the returned `yaw` is the **local span**
 * heading, not the chord heading, so a box placed here is aligned with the road
 * it actually touches rather than with a line crossing it.
 */
export function placementAt(seg: SegmentGeometry, s: number, lateral = 0): PlacementFrame {
  const pose = poseAt(seg, s);
  return {
    x: pose.x + pose.leftX * lateral,
    z: pose.z + pose.leftZ * lateral,
    ux: pose.ux,
    uz: pose.uz,
    leftX: pose.leftX,
    leftZ: pose.leftZ,
    yaw: Math.atan2(pose.ux, pose.uz),
    spanIndex: pose.spanIndex,
    s: pose.s,
  };
}
