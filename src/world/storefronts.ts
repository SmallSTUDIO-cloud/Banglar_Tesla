/**
 * Verified named storefronts on Ring Road and Tajmahal Road (v0.7.0).
 *
 * Every entry is a real business recorded in
 * `data/mohammadpur/mohammadpur.osm.json`. The rule this module exists to
 * enforce: a named signboard may only appear where that business actually is.
 * Handing out plausible-looking shop names to random buildings would be
 * geographic fabrication, so nothing here is invented — each record carries its
 * OSM id, its unmodified coordinates, and the projected game position.
 *
 * A note on language: these particular OSM features carry only a Latin `name`
 * (`name:bn` is absent). The board therefore shows the **real** business name
 * plus a **generic Bengali category word** derived from the OSM tag
 * (`shop=pharmacy` -> ফার্মেসি). That category word is a descriptor, not a
 * transliteration of the name, so no Bengali business name is fabricated.
 */

import { PROJECTION } from './landmarks';

/** Bengali category label for an OSM shop/amenity tag value. */
export const CATEGORY_BN: Record<string, string> = {
  pharmacy: 'ফার্মেসি',
  bakery: 'বেকারি',
  confectionery: 'মিষ্টি ও বেকারি',
  restaurant: 'রেস্টুরেন্ট',
  cafe: 'ক্যাফে',
  optician: 'চশমা ঘর',
  tailor: 'দর্জি ঘর',
  stationery: 'স্টেশনারি',
  general: 'মুদি দোকান',
  mobile_phone_accessories: 'মোবাইল আনুষাঙ্গিক',
  clothes: 'কাপড়ের দোকান',
  car_repair: 'গাড়ি মেরামত',
  motorcycle_repair: 'মোটরসাইকেল মেরামত',
  car_parts: 'গাড়ির পার্টস',
  dentist: 'দন্ত চিকিৎসা',
  clinic: 'ক্লিনিক',
  driving_school: 'ড্রাইভিং স্কুল',
  travel_agency: 'ট্রাভেলস',
  leather: 'চামড়ার দোকান',
  electronics: 'ইলেকট্রনিক্স',
};

export type StorefrontCorridor = 'ring' | 'tajmahal';

export interface Storefront {
  /** Stable id, also used as the sign atlas key. */
  id: string;
  corridor: StorefrontCorridor;
  /** The real business name exactly as recorded in OSM. */
  name: string;
  /** OSM tag value the category label derives from. */
  osmKind: string;
  /** Bengali category descriptor (never a transliteration of `name`). */
  categoryBn: string;
  source: { osmId: number; osmType: 'node' | 'way' | 'relation'; lat: number; lon: number };
  /** Projected OSM position, in game units. */
  x: number;
  z: number;
}

function storefront(
  id: string,
  corridor: StorefrontCorridor,
  name: string,
  osmKind: string,
  osmId: number,
  osmType: 'node' | 'way' | 'relation',
  lat: number,
  lon: number,
): Storefront {
  const x = (lon - PROJECTION.lon0) * PROJECTION.metresPerDegLon * PROJECTION.scale;
  const z = (PROJECTION.lat0 - lat) * PROJECTION.metresPerDegLat * PROJECTION.scale;
  return {
    id,
    corridor,
    name,
    osmKind,
    categoryBn: CATEGORY_BN[osmKind] ?? '',
    source: { osmId, osmType, lat, lon },
    // Stored to 2 dp, matching the landmark registry convention.
    x: Math.round(x * 100) / 100,
    z: Math.round(z * 100) / 100,
  };
}

/**
 * Curated set: the most legible named businesses actually on each corridor,
 * chosen for recognisability. Deliberately small — every one of these costs an
 * atlas cell, and the atlas is a single texture shared by the whole city.
 */
export const STOREFRONTS: readonly Storefront[] = [
  // ---------------------------------------------------------- Ring Road
  storefront('sf_meer_owshodh', 'ring', 'M/S Meer Owshodh Ghar', 'pharmacy', 6968431046, 'node', 23.7608160, 90.3590198),
  storefront('sf_dhaka_bakery', 'ring', 'Dhaka Bakery', 'bakery', 14271010399, 'node', 23.7618806, 90.3588248),
  storefront('sf_hanif_tehari', 'ring', 'Hanif Tehari House', 'restaurant', 14271010400, 'node', 23.7622242, 90.3587837),
  storefront('sf_pitha_house', 'ring', 'Pitha House', 'restaurant', 7145841093, 'node', 23.7671430, 90.3587021),

  // ------------------------------------------------------ Tajmahal Road
  storefront('sf_kings_confectionery', 'tajmahal', "King's Confectionery", 'confectionery', 11979021728, 'node', 23.7631675, 90.3611702),
  storefront('sf_taj_biriyani', 'tajmahal', 'Taj Biriyani', 'restaurant', 11978971231, 'node', 23.7635345, 90.3624764),
  storefront('sf_pusti_dairy', 'tajmahal', 'Pusti Dairy Farm Sweets & Bakery', 'confectionery', 11979111669, 'node', 23.7635762, 90.3626253),
  storefront('sf_dhakaiya_pharma', 'tajmahal', 'Dhakaiya Pharma', 'pharmacy', 6902633008, 'node', 23.7638228, 90.3636336),
];

export function storefrontsFor(corridor: StorefrontCorridor): readonly Storefront[] {
  return STOREFRONTS.filter((s) => s.corridor === corridor);
}

export function storefrontById(id: string): Storefront | undefined {
  return STOREFRONTS.find((s) => s.id === id);
}
