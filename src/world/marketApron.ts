/**
 * Market-apron street-activity planner (v0.7.0).
 *
 * The generic prop pass in `props.ts` spreads vendor stalls evenly over the
 * whole road graph, which makes every street look equally busy. Real
 * Mohammadpur bazaars are by far the densest street activity in the district.
 *
 * This module decides *where* those extra carts go and returns plain data, so
 * the placement can be validated in unit tests without constructing any
 * Three.js geometry (and without a canvas). `props.ts` only turns the plan
 * into meshes.
 *
 * Placement rules, all enforced here:
 *  - every cart sits on the sidewalk apron outside the carriageway;
 *  - carts open onto the road the market actually fronts;
 *  - carts stay within the market's own frontage, never scattered elsewhere;
 *  - vans/carts dominate, with tea and snack stalls filling gaps.
 */

import { PLACES, ROAD_SEGMENTS, distanceToRoadCarriageway, segmentById } from './layout';

export type ApronStallKind = 'veg' | 'fruit' | 'tea' | 'fuchka' | 'jhalmuri';

export interface ApronStallPlan {
  placeId: string;
  kind: ApronStallKind;
  x: number;
  z: number;
  yaw: number;
}

/**
 * Markets that receive a concentrated apron crowd. Ids refer to `PLACES`;
 * the geographic identity behind each id lives in `landmarks.ts`.
 */
const MARKET_APRON_PLACES = ['bazaar', 'market'] as const;

/**
 * Vegetable vans and fruit carts dominate a Dhaka kacha bazar; tea and fuchka
 * fill the gaps. Order is the physical order along the frontage so the mix
 * reads naturally rather than clustering identical carts.
 */
const APRON_KINDS: readonly ApronStallKind[] = [
  'veg',
  'fruit',
  'veg',
  'tea',
  'veg',
  'fuchka',
  'veg',
  'jhalmuri',
  'fruit',
];

/** Centre-to-centre spacing between adjacent apron carts, in metres. */
const APRON_SPACING = 3.1;

/** Minimum asphalt clearance a cart footprint centre must keep. */
export const APRON_MIN_CLEARANCE = 1.2;

export interface MarketSignPlan {
  placeId: string;
  /** Landmark whose bespoke board to use (see `SignAtlas.landmarkSlot`). */
  landmarkId: string;
  x: number;
  z: number;
  yaw: number;
}

/** Setback of the entrance board behind the apron line, in metres. */
const SIGN_SETBACK = 2.4;

/**
 * Entrance boards for the two authoritative markets. The board is set back
 * further from the road than the vendor line so it frames the market entrance
 * without standing between the road and the carts.
 */
export function planMarketSignage(): MarketSignPlan[] {
  const plan: MarketSignPlan[] = [];
  for (const placeId of MARKET_APRON_PLACES) {
    const place = PLACES.find((p) => p.id === placeId);
    if (!place) continue;
    const seg = segmentById(place.segmentId) ?? ROAD_SEGMENTS[0];
    const lateralSign =
      (place.x - seg.ax) * seg.leftX + (place.z - seg.az) * seg.leftZ >= 0 ? 1 : -1;
    // Push further out than the place marker, i.e. away from the carriageway.
    const offset = seg.halfWidth + seg.sidewalk * 0.55 + SIGN_SETBACK;
    let along = 0;
    let bestD = Infinity;
    for (let t = 0; t <= seg.length; t += 0.5) {
      const d = Math.hypot(place.x - (seg.ax + seg.ux * t), place.z - (seg.az + seg.uz * t));
      if (d < bestD) {
        bestD = d;
        along = t;
      }
    }
    const bx = seg.ax + seg.ux * along + seg.leftX * offset * lateralSign;
    const bz = seg.az + seg.uz * along + seg.leftZ * offset * lateralSign;
    if (distanceToRoadCarriageway(bx, bz) < APRON_MIN_CLEARANCE) continue;
    plan.push({
      placeId,
      landmarkId: placeId === 'bazaar' ? 'town_hall_bazar' : 'krishi_market',
      x: bx,
      z: bz,
      yaw: Math.atan2(-seg.leftX * lateralSign, -seg.leftZ * lateralSign),
    });
  }
  return plan;
}

export function planMarketApron(): ApronStallPlan[] {
  const plan: ApronStallPlan[] = [];
  for (const placeId of MARKET_APRON_PLACES) {
    const place = PLACES.find((p) => p.id === placeId);
    if (!place) continue;
    const seg = segmentById(place.segmentId) ?? ROAD_SEGMENTS[0];

    // Where along this segment the market frontage sits.
    let along = 0;
    let bestD = Infinity;
    for (let t = 0; t <= seg.length; t += 0.5) {
      const d = Math.hypot(place.x - (seg.ax + seg.ux * t), place.z - (seg.az + seg.uz * t));
      if (d < bestD) {
        bestD = d;
        along = t;
      }
    }

    // Which side of the road the frontage occupies.
    const lateralSign =
      (place.x - seg.ax) * seg.leftX + (place.z - seg.az) * seg.leftZ >= 0 ? 1 : -1;
    const apronOffset = (seg.halfWidth + seg.sidewalk * 0.62) * lateralSign;
    const yaw = Math.atan2(-seg.leftX * lateralSign, -seg.leftZ * lateralSign);

    for (let i = 0; i < APRON_KINDS.length; i++) {
      const t = Math.max(
        1.5,
        Math.min(seg.length - 1.5, along + (i - (APRON_KINDS.length - 1) / 2) * APRON_SPACING),
      );
      const x = seg.ax + seg.ux * t + seg.leftX * apronOffset;
      const z = seg.az + seg.uz * t + seg.leftZ * apronOffset;
      // Never emit a cart that would sit on the asphalt. Checked here so the
      // invariant is testable independently of mesh construction.
      if (distanceToRoadCarriageway(x, z) < APRON_MIN_CLEARANCE) continue;
      plan.push({ placeId, kind: APRON_KINDS[i], x, z, yaw });
    }
  }
  return plan;
}
