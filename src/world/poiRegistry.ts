/**
 * Verified Mohammadpur point-of-interest registry.
 *
 * Every entry is machine-derived from `data/mohammadpur/mohammadpur.osm.json`
 * (ODbL 1.0). `lat`/`lon` are copied verbatim from the extract's `center`, and
 * `x`/`z` are the same WGS84 projection the world uses:
 *
 *     x = (lon - 90.3646) * 111320 * cos(23.7624 deg) * 0.36
 *     z = (23.7624 - lat) * 111132 * 0.36
 *
 * `tests/unit/poi-registry.test.ts` re-derives x/z from lat/lon and fails on any
 * drift beyond 5 mm, and re-checks each OSM id against the dataset, so a
 * hand-edited or invented coordinate cannot survive.
 *
 * Routing availability is NOT stored here. The map derives it at runtime from
 * the live road graph, so a POI automatically becomes routable as soon as the
 * roads around it are migrated. See `src/world/mapRouting.ts`.
 */

export type PoiCategory =
  | 'market'
  | 'mosque'
  | 'park'
  | 'landmark'
  | 'education'
  | 'transport'
  | 'camp'
  | 'commercial';

export interface Poi {
  /** Stable id used by the UI, routing and saves. Never rename. */
  id: string;
  nameEn: string;
  nameBn: string;
  category: PoiCategory;
  /** OSM feature id in `mohammadpur.osm.json`. */
  osmId: number;
  osmType: 'way' | 'node' | 'relation';
  lat: number;
  lon: number;
  /** Projected game coordinate, in metres. */
  x: number;
  z: number;
  /** False when the feature is real but lies outside the playable extent. */
  insideWorld: boolean;
  /** Verified distinguishing features, or an explicit uncertainty. */
  note: string;
}

export const POIS: Poi[] = [
  {
    id: 'town_hall_bazar',
    nameEn: "Mohammadpur Town Hall Bazar",
    nameBn: "মোহাম্মদপুর টাউন হল বাজার",
    category: 'market',
    osmId: 223068917,
    osmType: 'way',
    lat: 23.759947742,
    lon: 90.366370408,
    x: 64.9347,
    z: 98.1088,
    insideWorld: true,
    note: "Marketplace polygon. 1950s two-storey supermarket building plus open kacha bazar (est. 1970-71).",
  },
  {
    id: 'town_hall_mosque',
    nameEn: "Shaheed Park Jame Masjid (Town Hall Mosque)",
    nameBn: "শহীদ পার্ক জামে মসজিদ",
    category: 'mosque',
    osmId: 3030299890,
    osmType: 'node',
    lat: 23.7596499,
    lon: 90.3654123,
    x: 29.7934,
    z: 110.0247,
    insideWorld: true,
    note: "OSM node; stands opposite the bazar across Asad Avenue.",
  },
  {
    id: 'town_hall_bus_stop',
    nameEn: "Town Hall Bus Stop",
    nameBn: "টাউন হল বাস স্টপ",
    category: 'transport',
    osmId: 12014830074,
    osmType: 'node',
    lat: 23.7596689,
    lon: 90.3662806,
    x: 61.6407,
    z: 109.2645,
    insideWorld: true,
    note: "OSM node, no tags.",
  },
  {
    id: 'shahid_park_market',
    nameEn: "Shahid Park Masjid Market",
    nameBn: "শহীদ পার্ক মসজিদ মার্কেট",
    category: 'market',
    osmId: 367594623,
    osmType: 'way',
    lat: 23.759633137,
    lon: 90.365487137,
    x: 32.5382,
    z: 110.6953,
    insideWorld: true,
    note: "Small variety-store building on the market block.",
  },
  {
    id: 'krishi_market',
    nameEn: "Krishi Market, Block Kha",
    nameBn: "খ নং কৃষি পণ্যের পাইকারী বাজার",
    category: 'market',
    osmId: 494999392,
    osmType: 'way',
    lat: 23.76575645,
    lon: 90.359796975,
    x: -176.1644,
    z: -134.2832,
    insideWorld: true,
    note: "Government wholesale rice/produce market, est. 1981. Three tagged blocks in the extract.",
  },
  {
    id: 'krishi_market_gha',
    nameEn: "Krishi Market, Block Gha",
    nameBn: "ঘ নং কৃষি পণ্যের পাইকারী বাজার",
    category: 'market',
    osmId: 494999395,
    osmType: 'way',
    lat: 23.7658772,
    lon: 90.3597435,
    x: -178.1257,
    z: -139.1141,
    insideWorld: true,
    note: "Adjacent block of the same complex.",
  },
  {
    id: 'shia_jame_masjid',
    nameEn: "Shia Jame Masjid",
    nameBn: "শিয়া জামে মসজিদ",
    category: 'mosque',
    osmId: 374712754,
    osmType: 'way',
    lat: 23.762195575,
    lon: 90.35909125,
    x: -202.0488,
    z: 8.1785,
    insideWorld: true,
    note: "Building polygon; the adjacent landuse polygon 438545522 covers the same site.",
  },
  {
    id: 'tokyo_square',
    nameEn: "Tokyo Square",
    nameBn: "টোকিও স্কয়ার",
    category: 'commercial',
    osmId: 367227689,
    osmType: 'way',
    lat: 23.764942675,
    lon: 90.3584258,
    x: -226.4561,
    z: -101.7261,
    insideWorld: false,
    note: "building=commercial, 7 levels. Lies OUTSIDE the playable extent (x -226.5 < -218).",
  },
  {
    id: 'geneva_camp',
    nameEn: "Geneva Camp",
    nameBn: "জেনেভা ক্যাম্প",
    category: 'camp',
    osmId: 13990609728,
    osmType: 'node',
    lat: 23.7683996,
    lon: 90.3654545,
    x: 31.3412,
    z: -240.0291,
    insideWorld: true,
    note: "Bihari settlement, named 1972. Blocks A-B and C-I; 8x8 ft plots, dense 2-3 storey lanes.",
  },
  {
    id: 'tajmahal_park',
    nameEn: "Tajmahal Park",
    nameBn: "তাজমহল পার্ক",
    category: 'park',
    osmId: 297224783,
    osmType: 'way',
    lat: 23.7650216,
    lon: 90.36257096,
    x: -74.4207,
    z: -104.8837,
    insideWorld: true,
    note: "leisure=park; DNCC walkway, children play area, open field.",
  },
  {
    id: 'sat_gumbad_masjid',
    nameEn: "Saat Gumbad Masjid (Seven Domed Mosque)",
    nameBn: "সাত গম্বুজ মসজিদ",
    category: 'mosque',
    osmId: 1560283156,
    osmType: 'way',
    lat: 23.757710775,
    lon: 90.358969844,
    x: -206.5017,
    z: 187.6043,
    insideWorld: true,
    note: "Mughal, c.1680, seven domes (3 main + 4 corner pavilion), 75ft x 44ft, on a raised platform.",
  },
  {
    id: 'drmc',
    nameEn: "Dhaka Residential Model College",
    nameBn: "ঢাকা রেসিডেনশিয়াল মডেল কলেজ",
    category: 'education',
    osmId: 1008314351,
    osmType: 'way',
    lat: 23.765466575,
    lon: 90.367640825,
    x: 111.5308,
    z: -122.6861,
    insideWorld: true,
    note: "52-acre campus, est. 1960, six residential houses, many playing fields, walled and heavily treed.",
  },
  {
    id: 'drmc_gate',
    nameEn: "DRMC Gate",
    nameBn: "ডিআরএমসি গেট",
    category: 'education',
    osmId: 1386522766,
    osmType: 'way',
    lat: 23.7638613,
    lon: 90.365855233,
    x: 46.0392,
    z: -58.463,
    insideWorld: true,
    note: "Mapped gate structure; usable as a waypoint.",
  },
  {
    id: 'mohammadpur_bus_stand',
    nameEn: "Mohammadpur Bus Stand",
    nameBn: "মোহাম্মদপুর বাস স্ট্যান্ড",
    category: 'transport',
    osmId: 3712961702,
    osmType: 'node',
    lat: 23.7569928,
    lon: 90.3617359,
    x: -105.0489,
    z: 216.3287,
    insideWorld: true,
    note: "OSM node. Terminus for inter-area buses; heavy school-hour congestion.",
  },
  {
    id: 'mohammadpur_eidgah',
    nameEn: "Mohammadpur Eidgah Field",
    nameBn: "মোহাম্মদপুর ঈদগাহ",
    category: 'landmark',
    osmId: 297224497,
    osmType: 'way',
    lat: 23.763341325,
    lon: 90.36389775,
    x: -25.757,
    z: -37.6601,
    insideWorld: true,
    note: "landuse=recreation_ground / leisure=playground. Open field used for Eid prayers.",
  },
];

const BY_ID = new Map(POIS.map((p) => [p.id, p]));

export function poiById(id: string): Poi | undefined {
  return BY_ID.get(id);
}

/** POIs reachable inside the playable extent, in stable registry order. */
export const POIS_IN_WORLD: Poi[] = POIS.filter((p) => p.insideWorld);

