import { describe, expect, it } from 'vitest';
import { ROAD_SEGMENTS } from '../../src/world/layout';
import { arcLengthOf, placementAt, type SegmentGeometry, type Vec2 } from '../../src/world/roadGeometry';

/**
 * P2 — placement frames.
 *
 * Every object placed along a road (buildings, stalls, kerbs, markings, signs)
 * is positioned with the same pair of expressions:
 *
 *     x = seg.ax + seg.ux * s + seg.leftX * d
 *     yaw = Math.atan2(seg.ux, seg.uz)
 *
 * Both use the **chord** frame. On a curved centreline the position leaves the
 * road and the yaw points off the tangent, so a box is placed beside a road it
 * does not touch and rotated against it.
 *
 * `placementAt` is the single replacement. It must be a provable no-op on the
 * current graph and correct on a synthetic curve.
 */

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

/** The legacy chord placement, kept as the equivalence reference. */
function legacyPlacement(seg: SegmentGeometry, s: number, lateral: number) {
  return {
    x: seg.ax + seg.ux * s + seg.leftX * lateral,
    z: seg.az + seg.uz * s + seg.leftZ * lateral,
    yaw: Math.atan2(seg.ux, seg.uz),
  };
}

describe('placementAt is a provable no-op on the current graph', () => {
  it('reproduces the legacy chord placement on every segment', () => {
    let compared = 0;
    for (const seg of ROAD_SEGMENTS) {
      const arc = arcLengthOf(seg);
      for (const frac of [0, 0.15, 0.5, 0.85, 1]) {
        for (const lateral of [-12, -6.1, 0, 4.4, 20.75]) {
          const s = arc * frac;
          const got = placementAt(seg, s, lateral);
          const want = legacyPlacement(seg, s, lateral);
          expect(got.x, `${seg.id} f=${frac} d=${lateral}`).toBeCloseTo(want.x, 9);
          expect(got.z, `${seg.id} f=${frac} d=${lateral}`).toBeCloseTo(want.z, 9);
          expect(got.yaw, `${seg.id} f=${frac} d=${lateral}`).toBeCloseTo(want.yaw, 12);
          compared++;
        }
      }
    }
    expect(compared).toBe(1750); // 70 x 5 x 5
  });

  it('is bit-identical for the collinear prototype segment', () => {
    // asad_4 carries vertices, so this checks the polyline path against the chord
    // path rather than two copies of the same arithmetic.
    const seg = ROAD_SEGMENTS.find((s) => s.id === 'asad_4')!;
    expect(seg.vertices).toBeDefined();
    for (let s = 0; s <= seg.length; s += seg.length / 17) {
      const got = placementAt(seg, s, 0);
      const want = legacyPlacement(seg, s, 0);
      expect(got.x).toBeCloseTo(want.x, 12);
      expect(got.z).toBeCloseTo(want.z, 12);
      expect(got.yaw).toBeCloseTo(want.yaw, 12);
    }
  });

  it('keeps the left normal as (uz, -ux) so the side convention is unchanged', () => {
    for (const seg of ROAD_SEGMENTS) {
      const f = placementAt(seg, arcLengthOf(seg) * 0.5, 0);
      expect(f.leftX).toBeCloseTo(f.uz, 12);
      expect(f.leftZ).toBeCloseTo(-f.ux, 12);
    }
  });
});

describe('placementAt follows a curve where the chord does not', () => {
  // A 90-degree corner, 20-unit arms.
  const corner = makeSynthetic([
    { x: 0, z: 0 },
    { x: 20, z: 0 },
    { x: 20, z: 20 },
  ]);

  it('places lateral objects at the correct distance from the real road', () => {
    const lateral = 6;
    for (let s = 0; s <= 40; s += 2) {
      const f = placementAt(corner, s, lateral);
      // The placed point must be exactly `lateral` from the centreline it came
      // from — true by construction, but this pins the lateral sign too.
      const centre = placementAt(corner, s, 0);
      const d = Math.hypot(f.x - centre.x, f.z - centre.z);
      expect(d, `s=${s}`).toBeCloseTo(Math.abs(lateral), 9);
    }
  });

  it('rotates objects along the local tangent, not the chord', () => {
    // On the second arm the tangent points +z; the chord points diagonally.
    const onArmTwo = placementAt(corner, 30, 5);
    expect(onArmTwo.ux).toBeCloseTo(0, 9);
    expect(onArmTwo.uz).toBeCloseTo(1, 9);
    expect(onArmTwo.yaw).toBeCloseTo(0, 9); // atan2(0, 1)

    const onArmOne = placementAt(corner, 10, 5);
    expect(onArmOne.ux).toBeCloseTo(1, 9);
    expect(onArmOne.yaw).toBeCloseTo(Math.PI / 2, 9); // atan2(1, 0)

    // The chord yaw is a compromise that is wrong on both arms.
    expect(Math.abs(Math.atan2(corner.ux, corner.uz) - onArmOne.yaw)).toBeGreaterThan(0.5);
  });

  it('shows how far a chord-placed building drifts on a curve', () => {
    // The concrete failure this migration prevents: at arc distance 35 the road
    // is at (20,15); the chord says it is near (17.7,17.7), 2.4 units away.
    const s = 35;
    const road = placementAt(corner, s, 0);
    const chord = legacyPlacement(corner, s, 0);
    const drift = Math.hypot(road.x - chord.x, road.z - chord.z);
    expect(drift).toBeGreaterThan(2);
    // A building set back 12 units would therefore sit ~2.4 units too close to
    // the real kerb, or inside it, depending on the side.
  });

  it('never returns a position off the polyline for zero lateral offset', () => {
    for (let s = 0; s <= 40; s += 1) {
      const f = placementAt(corner, s, 0);
      const expectedX = s <= 20 ? s : 20;
      const expectedZ = s <= 20 ? 0 : s - 20;
      expect(f.x, `s=${s}`).toBeCloseTo(expectedX, 9);
      expect(f.z, `s=${s}`).toBeCloseTo(expectedZ, 9);
    }
  });
});
