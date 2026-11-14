import { describe, expect, it } from 'vitest';
import {
  GRAPH_NODES,
  PLACES,
  ROAD_SEGMENTS,
  distanceToRoadCarriageway,
  distanceToRoadCorridor,
  placeApproachPose,
  placeById,
  pointToSegmentDistance,
  type RoadSegment,
} from '../../src/world/layout';
import { arcLengthOf, projectOntoPolyline } from '../../src/world/roadGeometry';

/**
 * P2 slice 3 — clearance queries and approach poses.
 *
 * `distanceToRoadCarriageway` / `distanceToRoadCorridor` drive sidewalk clipping
 * and prop rejection throughout `city.ts`; `placeApproachPose` decides where the
 * player/vehicle is placed when approaching a destination. All three used chord
 * projection, so on a curve they measured and placed against a line that is not
 * the road.
 *
 * Every migration here must be a provable no-op on the current graph. The legacy
 * chord implementations are kept verbatim below as the reference.
 */

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Legacy chord projection parameter onto one segment. */
function legacyProject(px: number, pz: number, s: RoadSegment) {
  const vx = px - s.ax;
  const vz = pz - s.az;
  const proj = clamp(vx * s.ux + vz * s.uz, 0, s.length);
  const cx = s.ax + s.ux * proj;
  const cz = s.az + s.uz * proj;
  return { proj, cx, cz, dist: Math.hypot(px - cx, pz - cz) };
}

function legacyCarriageway(px: number, pz: number): number {
  let min = 999;
  for (const s of ROAD_SEGMENTS) {
    const d = legacyProject(px, pz, s).dist - s.halfWidth;
    if (d < min) min = d;
  }
  for (const n of GRAPH_NODES) {
    const d = Math.hypot(px - n.x, pz - n.z) - n.radius;
    if (d < min) min = d;
  }
  return min;
}

function legacyCorridor(px: number, pz: number): number {
  let min = 999;
  for (const s of ROAD_SEGMENTS) {
    const d = legacyProject(px, pz, s).dist - (s.halfWidth + s.sidewalk);
    if (d < min) min = d;
  }
  for (const n of GRAPH_NODES) {
    const d = Math.hypot(px - n.x, pz - n.z) - n.outerRadius;
    if (d < min) min = d;
  }
  return min;
}

describe('pointToSegmentDistance is a provable no-op', () => {
  it('matches the legacy chord maths for every segment', () => {
    let compared = 0;
    for (const s of ROAD_SEGMENTS) {
      for (const frac of [-0.2, 0, 0.13, 0.5, 0.87, 1, 1.2]) {
        for (const lateral of [-9, -2, 0, 3.5, 12]) {
          const base = { x: s.ax + s.ux * s.length * frac, z: s.az + s.uz * s.length * frac };
          const px = base.x + s.leftX * lateral;
          const pz = base.z + s.leftZ * lateral;
          const got = pointToSegmentDistance(px, pz, s);
          const want = legacyProject(px, pz, s);
          expect(got.dist, `${s.id} f=${frac} l=${lateral}`).toBeCloseTo(want.dist, 9);
          expect(got.cx, `${s.id}`).toBeCloseTo(want.cx, 9);
          expect(got.cz, `${s.id}`).toBeCloseTo(want.cz, 9);
          expect(got.t, `${s.id}`).toBeCloseTo(want.proj / s.length, 9);
          compared++;
        }
      }
    }
    expect(compared).toBe(2450); // 70 segments x 7 x 5
  });

  it('keeps t normalised to [0, 1] and monotonic along the road', () => {
    const s = ROAD_SEGMENTS[0];
    let prev = -1;
    for (let f = 0; f <= 1.0001; f += 0.1) {
      const p = { x: s.ax + s.ux * s.length * f, z: s.az + s.uz * s.length * f };
      const { t } = pointToSegmentDistance(p.x, p.z, s);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
      expect(t).toBeGreaterThan(prev);
      prev = t;
    }
  });
});

describe('road clearance queries are a provable no-op', () => {
  /**
   * These functions search a spatial bucket, not the whole graph, so they report
   * an **upper bound**: a segment in a neighbouring cell can be nearer than
   * anything in the query cell (observed: 54.08 reported vs 34.58 true). That is
   * pre-existing bucket behaviour and has nothing to do with the projection
   * change, so comparing the export against a brute-force minimum is invalid.
   *
   * The projection change is instead proved two ways:
   *   1. per segment, by `pointToSegmentDistance` equivalence above (2,450 cases);
   *   2. near a road — the regime the callers care about — where the bucket
   *      certainly contains that road, so the export must match legacy exactly.
   */

  it('matches the legacy chord maths for points near a carriageway', () => {
    let compared = 0;
    for (const s of ROAD_SEGMENTS) {
      for (const frac of [0.25, 0.5, 0.75]) {
        for (const lateral of [0, 0.4, -0.4, 2.5, -2.5]) {
          const base = { x: s.ax + s.ux * s.length * frac, z: s.az + s.uz * s.length * frac };
          const px = base.x + s.leftX * lateral;
          const pz = base.z + s.leftZ * lateral;
          expect(distanceToRoadCarriageway(px, pz), `${s.id} f=${frac} l=${lateral}`).toBeCloseTo(
            legacyCarriageway(px, pz),
            9,
          );
          expect(distanceToRoadCorridor(px, pz), `${s.id} corridor`).toBeCloseTo(
            legacyCorridor(px, pz),
            9,
          );
          compared++;
        }
      }
    }
    expect(compared).toBe(1050); // 70 segments x 3 x 5
  });

  it('never reports closer than the true polyline distance (bucket is a subset)', () => {
    // A bucket can only miss segments, so the reported clearance is an upper
    // bound on the true one. It must never be smaller, which would mean the
    // function invented a road that is not there.
    let checked = 0;
    for (let x = -280; x <= 320; x += 37) {
      for (let z = -170; z <= 230; z += 37) {
        let truth = 999;
        for (const s of ROAD_SEGMENTS) {
          const p = projectOntoPolyline(s, x, z);
          truth = Math.min(truth, Math.hypot(x - p.x, z - p.z) - s.halfWidth);
        }
        for (const n of GRAPH_NODES) {
          truth = Math.min(truth, Math.hypot(x - n.x, z - n.z) - n.radius);
        }
        const got = distanceToRoadCarriageway(x, z);
        if (got === 999) continue; // empty bucket cell
        expect(got, `(${x}, ${z})`).toBeGreaterThanOrEqual(truth - 1e-6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('classifies on-road and off-road points the way the callers expect', () => {
    // city.ts gates sidewalk/prop placement on this sign, so the sign must be
    // right, not merely continuous.
    // Every segment midpoint is on asphalt.
    for (const s of ROAD_SEGMENTS) {
      const mid = { x: s.ax + s.ux * s.length * 0.5, z: s.az + s.uz * s.length * 0.5 };
      expect(distanceToRoadCarriageway(mid.x, mid.z), s.id).toBeLessThan(0);
    }

    // An off-road point must be *found*, not assumed: Mohammadpur is dense enough
    // that a fixed lateral offset lands on another street. Scan for a point that
    // brute-force projection agrees is genuinely far from every carriageway.
    let probe: { x: number; z: number } | null = null;
    for (let x = -300; x <= 340 && !probe; x += 7) {
      for (let z = -190; z <= 250; z += 7) {
        let truth = 999;
        for (const s of ROAD_SEGMENTS) {
          const q = projectOntoPolyline(s, x, z);
          truth = Math.min(truth, Math.hypot(x - q.x, z - q.z) - s.halfWidth);
        }
        if (truth > 20) {
          probe = { x, z };
          break;
        }
      }
    }
    expect(probe, 'no empty point found — map is fully covered').not.toBeNull();
    expect(distanceToRoadCarriageway(probe!.x, probe!.z)).toBeGreaterThan(0);
  });
});

describe('placeApproachPose is a provable no-op', () => {
  it('matches the legacy chord maths for every place', () => {
    let compared = 0;
    for (const place of PLACES) {
      const seg = place.segmentId ? ROAD_SEGMENTS.find((s) => s.id === place.segmentId) : undefined;
      if (!seg) continue;
      const dx = place.x - seg.ax;
      const dz = place.z - seg.az;
      const along = clamp(dx * seg.ux + dz * seg.uz, 0, seg.length);
      const lateral =
        (place.x - (seg.ax + seg.ux * along)) * seg.leftX +
        (place.z - (seg.az + seg.uz * along)) * seg.leftZ;
      const side = lateral >= 0 ? 1 : -1;
      const laneOffset = (seg.halfWidth - 0.5) * side;
      const wantX = seg.ax + seg.ux * along + seg.leftX * laneOffset;
      const wantZ = seg.az + seg.uz * along + seg.leftZ * laneOffset;

      const got = placeApproachPose(place.id)!;
      expect(got.x, `${place.id}.x`).toBeCloseTo(wantX, 9);
      expect(got.z, `${place.id}.z`).toBeCloseTo(wantZ, 9);
      expect(got.yaw, `${place.id}.yaw`).toBe(place.heading);
      compared++;
    }
    expect(compared).toBe(PLACES.length);
    expect(compared).toBe(14); // every place currently resolves to a segment
  });

  it('keeps every approach pose on the asphalt of its own road', () => {
    // The whole point of the function: the vehicle must not spawn off the road.
    for (const place of PLACES) {
      const pose = placeApproachPose(place.id);
      if (!pose) continue;
      const seg = ROAD_SEGMENTS.find((s) => s.id === place.segmentId);
      if (!seg) continue;
      const proj = projectOntoPolyline(seg, pose.x, pose.z);
      const lateral = Math.abs(proj.lateral);
      expect(lateral, `${place.id} lateral ${lateral.toFixed(3)}`).toBeLessThanOrEqual(
        seg.halfWidth + 1e-6,
      );
      expect(proj.s, place.id).toBeGreaterThanOrEqual(-1e-9);
      expect(proj.s, place.id).toBeLessThanOrEqual(arcLengthOf(seg) + 1e-9);
    }
  });

  it('returns null for an unknown place and does not throw', () => {
    expect(placeApproachPose('no-such-place-id')).toBeNull();
    expect(placeById('no-such-place-id')).toBeUndefined();
  });
});
