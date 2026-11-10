import { describe, expect, it } from 'vitest';
import { ROAD_SEGMENTS } from '../../src/world/layout';
import { nearestRoad, poiReach, POI_ROAD_MAX_OFFSET_M } from '../../src/world/mapRouting';
import { projectOntoPolyline } from '../../src/world/roadGeometry';
import type { Poi } from '../../src/world/poiRegistry';

/**
 * P2 slice 2 — navigation projection.
 *
 * `nearestRoad` decides which road a destination is served by, and `poiReach`
 * gates whether it is routable at all. Both used chord projection, so a POI near
 * a curve could be measured against a chord far from the drawn road.
 *
 * The migration must be a provable no-op on the current graph: the legacy chord
 * implementation is kept below as the reference.
 */

/** The pre-P2 chord implementation, kept verbatim as the equivalence reference. */
function legacyNearestRoad(x: number, z: number) {
  let best: { segmentId: string; distance: number; x: number; z: number } | null = null;
  for (const segment of ROAD_SEGMENTS) {
    const vx = segment.bx - segment.ax;
    const vz = segment.bz - segment.az;
    const len2 = vx * vx + vz * vz;
    const t =
      len2 === 0
        ? 0
        : Math.max(0, Math.min(1, ((x - segment.ax) * vx + (z - segment.az) * vz) / len2));
    const px = segment.ax + t * vx;
    const pz = segment.az + t * vz;
    const distance = Math.hypot(x - px, z - pz);
    if (!best || distance < best.distance) best = { segmentId: segment.id, distance, x: px, z: pz };
  }
  return best;
}

describe('nearestRoad is a provable no-op on the current graph', () => {
  it('matches the legacy chord implementation across a world-space grid', () => {
    let compared = 0;
    for (let x = -300; x <= 340; x += 8) {
      for (let z = -190; z <= 250; z += 8) {
        const got = nearestRoad(x, z);
        const want = legacyNearestRoad(x, z);
        expect(got).not.toBeNull();
        expect(got!.segment.id, `(${x}, ${z})`).toBe(want!.segmentId);
        expect(got!.distance, `(${x}, ${z})`).toBeCloseTo(want!.distance, 9);
        expect(Math.hypot(got!.x - want!.x, got!.z - want!.z), `(${x}, ${z})`).toBeLessThan(1e-9);
        compared++;
      }
    }
    // (-300..340 step 8) x (-190..250 step 8) = 81 x 56 = 4536 points.
    expect(compared).toBe(4536);
  });

  it('returns a point that actually lies on the road it names', () => {
    for (const seg of ROAD_SEGMENTS) {
      for (const frac of [0.1, 0.5, 0.9]) {
        const p = projectOntoPolyline(seg, seg.ax, seg.az);
        const probe = { x: seg.ax + (seg.bx - seg.ax) * frac, z: seg.az + (seg.bz - seg.az) * frac };
        const road = nearestRoad(probe.x, probe.z);
        expect(road).not.toBeNull();
        // The reported closest point must be on the named segment's centreline.
        const re = projectOntoPolyline(road!.segment, road!.x, road!.z);
        expect(Math.hypot(re.x - road!.x, re.z - road!.z)).toBeLessThan(1e-9);
        expect(p.s).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('poiReach gating is unchanged for existing points', () => {
  const mkPoi = (x: number, z: number, insideWorld = true): Poi =>
    ({ id: 'probe', category: 'landmark', x, z, insideWorld } as unknown as Poi);

  it('does not flip any incumbent destination to unroutable', () => {
    // Sweep the world and assert the routable/unroutable *decision* never changes
    // for a point that the legacy chord maths also resolved.
    let checked = 0;
    for (let x = -300; x <= 340; x += 12) {
      for (let z = -190; z <= 250; z += 12) {
        const legacy = legacyNearestRoad(x, z)!;
        const legacyOk = legacy.distance <= POI_ROAD_MAX_OFFSET_M;
        const nowOk = poiReach(mkPoi(x, z)).routable;
        // Polyline distance is never larger than chord distance, so the only
        // permitted difference is a point becoming routable that was not before.
        if (legacyOk) expect(nowOk, `(${x}, ${z}) became unroutable`).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('still refuses a point genuinely far from every road', () => {
    const reach = poiReach(mkPoi(-900, -900));
    expect(reach.routable).toBe(false);
  });

  it('refuses an out-of-world POI regardless of proximity', () => {
    const seg = ROAD_SEGMENTS[0];
    const mid = { x: (seg.ax + seg.bx) / 2, z: (seg.az + seg.bz) / 2 };
    expect(poiReach(mkPoi(mid.x, mid.z, false)).routable).toBe(false);
  });
});
