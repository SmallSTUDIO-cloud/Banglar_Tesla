/**
 * Frozen legacy layout ordering and fill ordinals.
 *
 * ## Why this exists
 *
 * `buildCity()` generates buildings in four passes that ran over `ROAD_SEGMENTS`
 * in array order and drew their dimensions from *mutable global counters*:
 *
 * | pass            | source order        | dimension input          |
 * |-----------------|---------------------|--------------------------|
 * | main apartment  | `ROAD_SEGMENTS`     | per-segment RNG (pinned) |
 * | infill strip    | `ROAD_SEGMENTS`     | `infillCount`            |
 * | block interior  | fixed world grid    | `interiorCount`          |
 * | shop-front fill | `ROAD_SEGMENTS`     | `infillCount` (shared)   |
 *
 * Both inputs are topology-dependent, so adding, removing or reordering a road
 * reshuffled buildings far away from it. Measured on the shipped world, merely
 * reversing `ROAD_SEGMENTS` replaced **674 of 845** building records:
 * 447 main, 112 interior, 58 infill, 57 shop-front.
 *
 * ## The fix
 *
 * 1. **Canonical order.** Generation iterates a canonical sequence — the frozen
 *    legacy order below, then any non-legacy segment sorted by id. Array order
 *    therefore stops being an input. Legacy always comes first, so a new road
 *    can never take a parcel a legacy road would have claimed.
 * 2. **Frozen ordinals.** Each legacy fill candidate's ordinal is looked up by
 *    its own stable coordinates instead of read from a running counter. Losing
 *    one candidate can no longer renumber every later candidate in the city.
 *
 * For the shipped 70-segment world legacy order equals array order and the
 * frozen ordinals equal the counters the old code would have produced, so the
 * generated world is bit-identical (845 buildings, digest `c60e15b5`).
 *
 * ## Regenerating
 *
 * Do **not** regenerate these tables. They describe the city that ships. See
 * `docs/INTERIOR_INFILL_ISOLATION.md` for the capture procedure and the
 * `tests/unit/fill-isolation.test.ts` guards.
 */

/**
 * The 70 legacy segment ids, in the exact order the shipped world was built in.
 * Generation iterates this order, never `ROAD_SEGMENTS` order.
 */
export const LEGACY_SEGMENT_ORDER: readonly string[] = [
  'asad_0',
  'asad_1',
  'asad_2',
  'asad_3',
  'asad_4',
  'asad_5',
  'asad_6',
  'satmasjid_1',
  'satmasjid_2',
  'zakir_1',
  'zakir_2',
  'zakir_3',
  'zakir_4',
  'zakir_5',
  'zakir_6',
  'ring_0',
  'ring_1',
  'ring_2',
  'ring_3',
  'ring_4',
  'nurjahan_1',
  'nurjahan_2',
  'nurjahan_w',
  'chanmia_s',
  'salimullah_1',
  'salimullah_2',
  'salimullah_link',
  'shershah_1',
  'shershah_2',
  'shershah_cross',
  'shershah_deadend',
  'tajmahal_1',
  'tajmahal_2',
  'tajmahal_3',
  'tajmahal_4',
  'tajmahal_5',
  'aziz_1',
  'aziz_2',
  'aziz_3',
  'shahjahan_1',
  'shahjahan_2',
  'shahjahan_3',
  'post_shahjahan',
  'aurangzeb_1',
  'aurangzeb_2',
  'iqbal_1',
  'iqbal_2',
  'iqbal_gate',
  'humayun_1',
  'humayun_2',
  'humayun_3',
  'humayun_4',
  'humayun_taj',
  'aurangzeb_humayun',
  'iqbal_humayun',
  'babar_0',
  'babar_1',
  'babar_2',
  'babar_3',
  'babar_link_w',
  'babar_link_m',
  'babar_link_h',
  'babar_link_e',
  'babar_deadend',
  'bazar_cut_n',
  'bazar_cut_se',
  'krishi_cut_s',
  'krishi_cut_n',
  'lalmatia_cut',
  'johuri_bypass',
];

/** Ordinal lookup key: coordinates rounded to 2 dp (1 cm), stable per candidate. */
function key(x: number, z: number): string {
  return `${x.toFixed(2)},${z.toFixed(2)}`;
}

/**
 * Ordinal each shipped infill / shop-front candidate used for its tint and
 * height variant. Ordinals are contiguous 0..117 over both passes, matching the
 * shared `infillCount` the old code used.
 */
export const LEGACY_INFILL_ORDINALS: Readonly<Record<string, number>> = {
  '22.86,129.46': 0,
  '25.93,98.60': 1,
  '102.43,74.87': 2,
  '17.39,145.82': 3,
  '15.58,150.70': 4,
  '13.77,155.57': 5,
  '-15.17,210.87': 6,
  '-19.32,214.01': 7,
  '78.10,178.94': 8,
  '29.72,165.48': 9,
  '81.46,160.31': 10,
  '-178.56,137.21': 11,
  '-211.13,109.70': 12,
  '-194.54,54.49': 13,
  '-189.06,33.91': 14,
  '-190.09,97.37': 15,
  '-146.56,170.62': 16,
  '-150.12,166.83': 17,
  '-153.68,163.04': 18,
  '-157.24,159.25': 19,
  '-160.80,155.46': 20,
  '-67.60,33.58': 21,
  '5.56,-33.61': 22,
  '-169.87,-58.64': 23,
  '-122.68,-40.61': 24,
  '-3.76,-77.05': 25,
  '-3.38,-82.23': 26,
  '-131.34,-92.00': 27,
  '-73.11,-78.56': 28,
  '-85.78,-54.44': 29,
  '-86.91,-59.52': 30,
  '15.93,-54.37': 31,
  '20.60,-52.09': 32,
  '3.15,-109.95': 33,
  '71.84,21.53': 34,
  '121.04,-46.31': 35,
  '196.28,-42.44': 36,
  '201.33,-43.70': 37,
  '212.22,43.17': 38,
  '212.94,38.02': 39,
  '200.14,-30.13': 40,
  '200.71,-35.30': 41,
  '-198.70,-100.59': 42,
  '-144.44,-118.68': 43,
  '-13.20,-152.44': 44,
  '-8.09,-175.49': 45,
  '67.98,-194.83': 46,
  '-121.37,-122.55': 47,
  '-147.61,-104.70': 48,
  '102.00,-163.42': 49,
  '118.88,-53.94': 50,
  '198.62,-67.14': 51,
  '196.46,-71.87': 52,
  '-125.47,-193.04': 53,
  '-19.59,-207.20': 54,
  '80.25,-214.87': 55,
  '-164.10,-22.93': 56,
  '-161.90,-27.64': 57,
  '-159.70,-32.35': 58,
  '-120.30,207.16': 59,
  '-131.04,185.72': 60,
  '-92.13,194.01': 61,
  '99.72,101.84': 62,
  '102.98,100.89': 63,
  '-59.12,217.21': 64,
  '20.57,140.28': 65,
  '-24.34,216.49': 66,
  '-35.18,224.70': 67,
  '100.84,113.41': 68,
  '123.71,98.31': 69,
  '122.85,101.60': 70,
  '107.34,160.81': 71,
  '73.12,178.38': 72,
  '83.27,177.36': 73,
  '86.65,177.02': 74,
  '34.30,166.08': 75,
  '-104.64,66.85': 76,
  '-119.40,-17.08': 77,
  '-126.25,41.82': 78,
  '-142.72,173.19': 79,
  '-163.66,150.88': 80,
  '-60.44,-34.40': 81,
  '-85.79,41.20': 82,
  '-16.13,-30.96': 83,
  '-4.98,31.80': 84,
  '-1.71,30.86': 85,
  '1.56,29.93': 86,
  '4.83,28.99': 87,
  '-32.29,22.85': 88,
  '-29.02,21.92': 89,
  '-193.76,-51.54': 90,
  '-187.50,-75.16': 91,
  '-127.92,-38.13': 92,
  '23.83,-49.35': 93,
  '72.26,-13.75': 94,
  '56.05,-8.49': 95,
  '82.12,-17.11': 96,
  '64.80,-33.39': 97,
  '212.91,30.64': 98,
  '-204.44,-99.79': 99,
  '-19.18,-152.07': 100,
  '-9.27,-154.47': 101,
  '97.62,-175.76': 102,
  '159.61,-155.19': 103,
  '3.40,-240.32': 104,
  '72.62,-227.49': 105,
  '8.96,-182.54': 106,
  '7.70,-185.70': 107,
  '-1.14,-207.79': 108,
  '-8.70,-182.80': 109,
  '-21.33,-214.37': 110,
  '64.62,-202.86': 111,
  '-25.75,-237.00': 112,
  '-25.75,-240.40': 113,
  '-25.75,-243.80': 114,
  '-190.61,25.66': 115,
  '-191.31,-5.54': 116,
  '-171.94,-44.80': 117,
};

/** Ordinal each shipped block-interior candidate used for its size and floors. */
export const LEGACY_INTERIOR_ORDINALS: Readonly<Record<string, number>> = {
  '62.30,-95.80': 0,
  '212.60,-176.80': 1,
  '71.00,-82.40': 2,
  '130.00,10.40': 3,
  '203.90,-190.20': 4,
  '-220.90,187.40': 5,
  '215.70,-165.00': 6,
  '-209.10,212.60': 7,
  '38.70,-117.80': 8,
  '74.10,-70.60': 9,
  '-150.10,93.00': 10,
  '133.10,22.20': 11,
  '141.80,35.60': 12,
  '-129.60,108.00': 13,
  '47.40,-104.40': 14,
  '-224.00,175.60': 15,
  '62.30,-119.40': 16,
  '141.80,177.20': 17,
  '-212.20,200.80': 18,
  '71.00,-106.00': 19,
  '59.20,-131.20': 20,
  '-126.50,119.80': 21,
  '74.10,-94.20': 22,
  '141.80,153.60': 23,
  '50.50,-139.80': 24,
  '168.50,-1.40': 25,
  '-141.40,106.40': 26,
  '59.20,-84.00': 27,
  '121.30,1.80': 28,
  '35.60,-129.60': 29,
  '-173.70,-165.00': 30,
  '156.70,-92.60': 31,
  '212.60,-153.20': 32,
  '141.80,200.80': 33,
  '26.90,211.00': 34,
  '-165.00,84.40': 35,
  '200.80,-178.40': 36,
  '62.30,-143.00': 37,
  '192.10,119.80': 38,
  '-114.70,140.20': 39,
  '203.90,116.60': 40,
  '-197.30,214.20': 41,
  '153.60,-104.40': 42,
  '-220.90,163.80': 43,
  '130.00,34.00': 44,
  '133.10,163.80': 45,
  '144.90,-117.80': 46,
  '-224.00,152.00': 47,
  '-117.80,128.40': 48,
  '-224.00,-225.60': 49,
  '118.20,13.60': 50,
  '141.80,130.00': 51,
  '215.70,118.20': 52,
  '203.90,-166.60': 53,
  '-209.10,189.00': 54,
  '168.50,22.20': 55,
  '189.00,-222.40': 56,
  '192.10,-187.00': 57,
  '215.70,-141.40': 58,
  '165.40,-84.00': 59,
  '177.20,-11.60': 60,
  '189.00,-198.80': 61,
  '-153.20,81.20': 62,
  '153.60,-80.80': 63,
  '-114.70,116.60': 64,
  '-43.90,-190.20': 65,
  '-55.70,-187.00': 66,
  '-153.20,10.40': 67,
  '-161.90,-163.40': 68,
  '109.50,0.20': 69,
  '-161.90,96.20': 70,
  '153.60,-10.00': 71,
  '-176.80,-153.20': 72,
  '156.70,119.80': 73,
  '-138.30,118.20': 74,
  '-153.20,104.80': 75,
  '156.70,49.00': 76,
  '38.70,212.60': 77,
  '-67.50,-188.60': 78,
  '-165.00,-175.20': 79,
  '-91.10,-187.00': 80,
  '-212.20,177.20': 81,
  '-185.50,-166.60': 82,
  '130.00,175.60': 83,
  '168.50,45.80': 84,
  '133.10,-143.00': 85,
  '133.10,187.40': 86,
  '121.30,25.40': 87,
  '144.90,118.20': 88,
  '133.10,45.80': 89,
  '47.40,202.40': 90,
  '-129.60,131.60': 91,
  '-117.80,104.80': 92,
  '180.30,118.20': 93,
  '-82.40,-178.40': 94,
  '62.30,140.20': 95,
  '-79.30,-190.20': 96,
  '-55.70,190.60': 97,
  '165.40,-13.20': 98,
  '59.20,57.60': 99,
  '-200.40,202.40': 100,
  '-55.70,96.20': 101,
  '-94.20,-175.20': 102,
  '168.50,116.60': 103,
  '-224.00,104.80': 104,
  '177.20,12.00': 105,
  '-102.90,-188.60': 106,
  '212.60,-129.60': 107,
  '121.30,-210.60': 108,
  '-220.90,140.20': 109,
  '156.70,-116.20': 110,
  '-185.50,211.00': 111,
  '-58.80,84.40': 112,
  '35.60,200.80': 113,
  '74.10,212.60': 114,
  '121.30,167.00': 115,
  '-165.00,-10.00': 116,
  '-32.10,-188.60': 117,
  '200.80,104.80': 118,
  '-117.80,152.00': 119,
  '47.40,-151.60': 120,
  '-91.10,-116.20': 121,
  '-91.10,1.80': 122,
  '-188.60,-154.80': 123,
  '59.20,-154.80': 124,
  '-35.20,177.20': 125,
  '-150.10,22.20': 126,
  '-220.90,-213.80': 127,
  '-126.50,143.40': 128,
  '-185.50,-143.00': 129,
  '23.80,-202.00': 130,
  '-212.20,-224.00': 131,
  '-43.90,187.40': 132,
  '180.30,-212.20': 133,
  '-58.80,178.80': 134,
  '200.80,-154.80': 135,
  '-106.00,-176.80': 136,
  '109.50,-212.20': 137,
  '-224.00,128.40': 138,
  '-165.00,13.60': 139,
  '-209.10,165.40': 140,
  '-150.10,-1.40': 141,
  '-176.80,82.80': 142,
  '-32.10,-23.40': 143,
  '-165.00,-151.60': 144,
  '-176.80,-176.80': 145,
  '-79.30,-119.40': 146,
  '203.90,-143.00': 147,
  '-23.40,-10.00': 148,
  '-35.20,-11.60': 149,
  '-20.30,167.00': 150,
  '-35.20,-129.60': 151,
  '130.00,-154.80': 152,
  '-70.60,-176.80': 153,
  '-106.00,153.60': 154,
  '-94.20,-10.00': 155,
  '97.70,-213.80': 156,
  '35.60,-200.40': 157,
  '-58.80,-128.00': 158,
  '-102.90,-117.80': 159,
};
/**
 * Canonical generation order for a segment list.
 *
 * Legacy segments appear in their frozen order (only those actually present),
 * then every non-legacy segment sorted by id. The result is a pure function of
 * the *set* of ids, so array order is irrelevant.
 */
export function canonicalSegments<T extends { id: string }>(segments: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const s of segments) byId.set(s.id, s);

  const legacy: T[] = [];
  for (const id of LEGACY_SEGMENT_ORDER) {
    const s = byId.get(id);
    if (s) legacy.push(s);
  }

  const known = new Set(LEGACY_SEGMENT_ORDER);
  const fresh = segments.filter((s) => !known.has(s.id)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return [...legacy, ...fresh];
}

/**
 * Frozen ordinal for a legacy fill candidate, or `undefined` when the candidate
 * is not part of the shipped world.
 *
 * Returning `undefined` rather than a counter is deliberate: a candidate that
 * the shipped world did not contain has no legacy identity, so it must not be
 * numbered by a global counter that other regions can shift.
 */
export function legacyInfillOrdinal(x: number, z: number): number | undefined {
  return LEGACY_INFILL_ORDINALS[key(x, z)];
}

/** Frozen ordinal for a legacy block-interior candidate. */
export function legacyInteriorOrdinal(x: number, z: number): number | undefined {
  return LEGACY_INTERIOR_ORDINALS[key(x, z)];
}

/** True when this segment predates fill isolation (mirrors the RNG table). */
export function isLegacyRoadSegment(id: string): boolean {
  return LEGACY_SEGMENT_ORDER.includes(id);
}
