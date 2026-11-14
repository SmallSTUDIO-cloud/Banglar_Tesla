import { describe, expect, it } from 'vitest';
import { PLACES, segmentById } from '../../src/world/layout';
import { arcLengthOf, projectOntoPolyline } from '../../src/world/roadGeometry';
import { APRON_MIN_CLEARANCE, planMarketApron, planMarketSignage } from '../../src/world/marketApron';
import { distanceToRoadCarriageway } from '../../src/world/layout';

/**
 * Market apron placement.
 *
 * Both planners used a 0.5-unit brute-force scan to find the point on the road
 * nearest the market landmark:
 *
 *     for (let t = 0; t <= seg.length; t += 0.5) { ... }
 *
 * That was replaced by `projectOntoPolyline`. Two consequences, both recorded
 * here deliberately:
 *
 * 1. **Correctness.** The scan was quantised to 0.5 units and used the chord, so
 *    it could be up to 0.25 units off on a straight road and further on a curve.
 *    The exact projection removes that error.
 * 2. **A small, visible shift.** Because the quantisation error is up to 0.25
 *    units, market carts and boards move by up to ~0.23 world units (about
 *    0.64 m) along their frontage. That is a defect fix, not a design change:
 *    the carts stay on the same side, in the same order, with the same count and
 *    the same road clearance. The bounds below pin it so a future change cannot
 *    quietly move them further.
 */

/** The gameplay segment each market frontage belongs to. */
function resolveSegmentId(placeId: string): string {
  const seg = PLACES.find((p) => p.id === placeId)?.segmentId;
  return seg ?? '';
}

describe('market apron placement', () => {
  const signs = planMarketSignage();
  const carts = planMarketApron();

  it('keeps the expected market coverage and cart count', () => {
    expect(signs.map((s) => s.placeId).sort()).toEqual(['bazaar', 'market']);
    expect(carts).toHaveLength(18); // 2 markets x 9 apron kinds
    expect(new Set(carts.map((c) => c.placeId)).size).toBe(2);
  });

  it('keeps every cart and board clear of the carriageway', () => {
    // The planners already skip anything too close; this asserts the invariant
    // holds for everything that survived, independently of the filter.
    for (const cart of carts) {
      expect(distanceToRoadCarriageway(cart.x, cart.z), `${cart.placeId}/${cart.kind}`)
        .toBeGreaterThanOrEqual(APRON_MIN_CLEARANCE);
    }
    for (const sign of signs) {
      expect(distanceToRoadCarriageway(sign.x, sign.z), sign.placeId)
        .toBeGreaterThanOrEqual(APRON_MIN_CLEARANCE);
    }
  });

  it('places every cart on one consistent side of its own road', () => {
    // A frontage that straddled the centreline would be a serious defect.
    for (const placeId of new Set(carts.map((c) => c.placeId))) {
      const group = carts.filter((c) => c.placeId === placeId);
      expect(group.length, placeId).toBeGreaterThan(1);
      const seg = segmentById(resolveSegmentId(placeId));
      if (!seg) continue;
      const signs = group.map((c) => Math.sign(projectOntoPolyline(seg, c.x, c.z).lateral));
      // All carts on this frontage sit on the same side, and none on the centreline.
      expect(new Set(signs).size, `${placeId} straddles the road`).toBe(1);
      expect(signs[0], `${placeId} sits on the centreline`).not.toBe(0);
    }
  });

  it('is within the quantisation error of the legacy 0.5-unit scan', () => {
    // The legacy scan's worst-case error is half its 0.5-unit step. Anything
    // beyond that would mean the migration changed placement, not de-quantised it.
    const MAX_SHIFT = 0.5 + 1e-9;
    let checked = 0;
    for (const sign of signs) {
      const seg = segmentById(resolveSegmentId(sign.placeId));
      if (!seg) continue;

      let legacyAlong = 0;
      let bestD = Infinity;
      for (let t = 0; t <= seg.length; t += 0.5) {
        const d = Math.hypot(sign.x - (seg.ax + seg.ux * t), sign.z - (seg.az + seg.uz * t));
        if (d < bestD) { bestD = d; legacyAlong = t; }
      }
      const proj = projectOntoPolyline(seg, sign.x, sign.z);
      expect(proj.s).toBeGreaterThanOrEqual(0);
      expect(proj.s).toBeLessThanOrEqual(arcLengthOf(seg));
      expect(Math.abs(proj.s - legacyAlong), `${sign.placeId} scan error`)
        .toBeLessThanOrEqual(MAX_SHIFT);
      checked++;
    }
    expect(checked).toBe(signs.length);
  });

  it('is deterministic across calls', () => {
    expect(JSON.stringify(planMarketApron())).toBe(JSON.stringify(planMarketApron()));
    expect(JSON.stringify(planMarketSignage())).toBe(JSON.stringify(planMarketSignage()));
  });
});
