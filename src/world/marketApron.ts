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
import { arcLengthOf, placementAt, projectOntoPolyline } from './roadGeometry';

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
  /** Unit vector along the frontage road, so a caller may nudge the board
   * along the street to a spot that is not inside a building. */
  dirX: number;
  dirZ: number;
}

/** Gap between the last vendor cart and the entrance board, in metres. */
const SIGN_GAP = 3.6;

/**
 * Entrance boards for the two authoritative markets.
 *
 * The board shares the vendor apron line rather than sitting further back.
 * That band is already proven clear of the carriageway *and* in front of the
 * building frontage, so the board cannot end up embedded in a shopfront — the
 * earlier 2.4 m extra setback put it straight inside a 12 m building at Town
 * Hall, which only showed up once it was rendered. Along the road it is placed
 * just past the last cart so it frames the market without touching one.
 */
export function planMarketSignage(): MarketSignPlan[] {
  const plan: MarketSignPlan[] = [];
  for (const placeId of MARKET_APRON_PLACES) {
    const place = PLACES.find((p) => p.id === placeId);
    if (!place) continue;
    const seg = segmentById(place.segmentId) ?? ROAD_SEGMENTS[0];
    // Polyline projection replaces a 0.5-unit brute-force scan: exact instead of
    // quantised, and correct on a curved segment. Returns the arc position.
    const proj = projectOntoPolyline(seg, place.x, place.z);
    const along = proj.s;
    const arc = arcLengthOf(seg);
    const lateralSign: 1 | -1 = proj.lateral >= 0 ? 1 : -1;
    const apronOffset = (seg.halfWidth + seg.sidewalk * 0.62) * lateralSign;
    // Local frame: the chord normal would rotate a curved frontage off its kerb.
    const apronFrame = placementAt(seg, along, 0);
    const yaw = Math.atan2(-apronFrame.leftX * lateralSign, -apronFrame.leftZ * lateralSign);

    // End of the vendor row, then just past it.
    const halfSpan = ((APRON_KINDS.length - 1) / 2) * APRON_SPACING;
    let boardAlong = along + halfSpan + SIGN_GAP;
    if (boardAlong > arc - 1.5) boardAlong = along - halfSpan - SIGN_GAP;
    if (boardAlong < 1.5 || boardAlong > arc - 1.5) continue;

    const boardFrame = placementAt(seg, boardAlong, apronOffset);
    const bx = boardFrame.x;
    const bz = boardFrame.z;
    if (distanceToRoadCarriageway(bx, bz) < APRON_MIN_CLEARANCE) continue;
    plan.push({
      placeId,
      landmarkId: placeId === 'bazaar' ? 'town_hall_bazar' : 'krishi_market',
      x: bx,
      z: bz,
      yaw,
      dirX: seg.ux,
      dirZ: seg.uz,
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
    // Polyline projection replaces a 0.5-unit brute-force scan: exact instead of
    // quantised, and correct on a curved segment. Returns the arc position.
    const proj = projectOntoPolyline(seg, place.x, place.z);
    const along = proj.s;
    const arc = arcLengthOf(seg);

    // Which side of the road the frontage occupies.
    const lateralSign: 1 | -1 = proj.lateral >= 0 ? 1 : -1;
    const apronOffset = (seg.halfWidth + seg.sidewalk * 0.62) * lateralSign;
    // Local frame: the chord normal would rotate a curved frontage off its kerb.
    const apronFrame = placementAt(seg, along, 0);
    const yaw = Math.atan2(-apronFrame.leftX * lateralSign, -apronFrame.leftZ * lateralSign);

    for (let i = 0; i < APRON_KINDS.length; i++) {
      const t = Math.max(
        1.5,
        Math.min(arc - 1.5, along + (i - (APRON_KINDS.length - 1) / 2) * APRON_SPACING),
      );
      const cartFrame = placementAt(seg, t, apronOffset);
      const x = cartFrame.x;
      const z = cartFrame.z;
      // Never emit a cart that would sit on the asphalt. Checked here so the
      // invariant is testable independently of mesh construction.
      if (distanceToRoadCarriageway(x, z) < APRON_MIN_CLEARANCE) continue;
      plan.push({ placeId, kind: APRON_KINDS[i], x, z, yaw });
    }
  }
  return plan;
}
