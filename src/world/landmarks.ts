/**
 * Verified Mohammadpur landmark registry (v0.7.0 geographic-accuracy layer).
 *
 * Every record here is traceable to a specific feature in
 * `data/mohammadpur/mohammadpur.osm.json` (ODbL 1.0). Nothing in this file is
 * invented: `source.osmId` / `source.lat` / `source.lon` are copied verbatim
 * from the imported OSM extract, and `x` / `z` are the *computed* projection of
 * those coordinates. `tests/unit/landmarks.test.ts` re-derives `x` / `z` from
 * the lat/lon and fails if the stored literals ever drift — so a fabricated or
 * hand-nudged coordinate cannot pass CI.
 *
 * This module deliberately imports nothing from `./layout`, because `layout.ts`
 * imports *this* file to anchor its named places onto real coordinates.
 * Keeping the dependency one-way avoids a module cycle.
 */

/** Projection constants shared with the OSM importer (see mohammadpurData.ts). */
export const PROJECTION = {
  /** Latitude of the game-world origin. */
  lat0: 23.7624,
  /** Longitude of the game-world origin. */
  lon0: 90.3646,
  /** Uniform scale from metres to game units. */
  scale: 0.36,
  /** Metres per degree of latitude. */
  metresPerDegLat: 111132,
  /** Metres per degree of longitude at `lat0`. */
  metresPerDegLon: 111320 * Math.cos((23.7624 * Math.PI) / 180),
} as const;

/** WGS84 lat/lon -> game-world metres (x = east, z = south). */
export function projectOsm(lat: number, lon: number): { x: number; z: number } {
  return {
    x: (lon - PROJECTION.lon0) * PROJECTION.metresPerDegLon * PROJECTION.scale,
    z: (PROJECTION.lat0 - lat) * PROJECTION.metresPerDegLat * PROJECTION.scale,
  };
}

/**
 * How confident we are that this record is the real-world place named by
 * `nameEn` / `nameBn`.
 *
 * - `verified`  — the OSM feature carries an explicit bilingual name that
 *                 matches the established real-world name for this location.
 * - `approx`    — the feature exists but the name or position is imprecise;
 *                 the record is documented as uncertain rather than guessed.
 */
export type LandmarkConfidence = 'verified' | 'approx';

export interface LandmarkSource {
  /** Feature id in `mohammadpur.osm.json` (OSM node or way id). */
  osmId: number;
  /** `node`, `way` or `relation`, as recorded by the importer. */
  osmType: 'node' | 'way' | 'relation';
  lat: number;
  lon: number;
}

export interface Landmark {
  id: string;
  nameEn: string;
  nameBn: string;
  /** Coarse category used to pick signage and street activity. */
  category: 'market' | 'camp' | 'mosque' | 'road';
  /** Projected OSM coordinate, in game units. */
  x: number;
  z: number;
  source: LandmarkSource;
  confidence: LandmarkConfidence;
  /**
   * Which side of `frontageSegmentId` the feature's OSM polygon predominantly
   * occupies (+1 = the `leftX`/`leftZ` side of the segment direction, -1 = the
   * other side). Derived by voting every polygon vertex against the nearest
   * carriageway, never guessed from the centroid — several Mohammadpur POI
   * nodes sit within ~1 m of the centreline, which makes a single point
   * useless for deciding a road side.
   */
  frontageSide?: 1 | -1;
  /** Road segment the frontage opens onto. */
  frontageSegmentId?: string;
  /**
   * Human-readable provenance / uncertainty note. Required whenever
   * `confidence` is `approx`, and used to explain known OSM data conflicts.
   */
  note?: string;
}

/**
 * Landmarks with coordinates taken directly from the OSM extract.
 *
 * Ordering is stable and purely for readability; consumers must look records up
 * by `id`, never by index.
 */
export const LANDMARKS: Landmark[] = [
  {
    id: 'town_hall_bazar',
    nameEn: 'Mohammadpur Town Hall Bazar',
    nameBn: 'মোহাম্মদপুর টাউন হল বাজার',
    category: 'market',
    x: 64.93,
    z: 98.11,
    source: { osmId: 223068917, osmType: 'way', lat: 23.7599477, lon: 90.3663704 },
    confidence: 'verified',
    frontageSide: -1,
    frontageSegmentId: 'asad_4',
    note: 'OSM way 223068917 "Mohammadpur Town Hall Market" (tags: amenity=marketplace, addr:street=Asad Avenue, addr:postcode=1207). Adjacent features corroborate the identification: Town Hall Mosque (3030299890), Shahid Park Masjid Market (367594623) and the Town Hall Bus stop (12014830074) all lie within ~60 m.',
  },
  {
    id: 'krishi_market',
    nameEn: 'Krishi Market',
    nameBn: 'কৃষি মার্কেট',
    category: 'market',
    x: -176.16,
    z: -134.28,
    source: { osmId: 494999392, osmType: 'way', lat: 23.7657564, lon: 90.3597970 },
    confidence: 'verified',
    frontageSide: 1,
    frontageSegmentId: 'humayun_1',
    note: 'OSM way 494999392 "খ নং কৃষি পণ্যের পাইকারী বাজার" — literally "agricultural produce wholesale market, block Kha"; tagged building=commercial rather than amenity=marketplace, so the market identity comes from the name, not the tag. Three sibling blocks — 494999395 (Gha), 494999396 (Cha & Ja), 508158045 (Ka & Gha) — form one contiguous complex within ~25 m; block Kha is used as the complex centroid.',
  },
  {
    id: 'geneva_camp',
    nameEn: 'Geneva Camp',
    nameBn: 'জেনেভা ক্যাম্প',
    category: 'camp',
    x: 31.34,
    z: -240.03,
    source: { osmId: 13990609728, osmType: 'node', lat: 23.7683996, lon: 90.3654545 },
    confidence: 'verified',
    note: 'OSM node 13990609728 is tagged place=quarter, which is the correct feature class for a settlement centroid. Two further features carry the same name: way 302622554 (residential polygon, same northern area — consistent) and way 481245650 (a separate polygon ~1 km to the SOUTH around 23.7592, 90.3670). The southern polygon conflicts with the well-established northern location of Geneva Camp and was NOT used for identity.',
  },
  {
    id: 'town_hall_mosque',
    nameEn: 'Town Hall Mosque',
    nameBn: 'টাউন হল মসজিদ',
    category: 'mosque',
    x: 29.79,
    z: 110.02,
    source: { osmId: 3030299890, osmType: 'node', lat: 23.7596499, lon: 90.3654123 },
    confidence: 'verified',
    note: 'OSM node 3030299890 "Town Hall Mosque", part of the Town Hall Bazar complex on Asad Avenue. Deliberately NOT labelled a Shia mosque: the separate Shia mosque near Ring Road x Tajmahal Road is a different place and has no matching feature in this extract.',
  },
];

export function landmarkById(id: string): Landmark | undefined {
  return LANDMARKS.find((l) => l.id === id);
}

/**
 * Landmarks that should carry concentrated market-side street activity
 * (vendors, carts, signboards). Kept as an explicit list so the props layer
 * never has to infer "is this a market?" from a name string.
 */
export const MARKET_LANDMARK_IDS = ['town_hall_bazar', 'krishi_market'] as const;
