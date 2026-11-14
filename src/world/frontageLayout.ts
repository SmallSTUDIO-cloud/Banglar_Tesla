/**
 * Frozen accept/reject sequence of the shipped street frontage.
 *
 * ## Why this exists
 *
 * `buildCity()` walks each segment's frontage and asks `canPlaceBuilding()` at
 * every step. That walk had two couplings, and both made a building's placement
 * depend on its *neighbours'* outcomes:
 *
 *   1. **Position.** A rejected candidate advanced the walk by 4.5 m; an accepted
 *      one advanced by its own width plus a 0.32–0.72 m gap. Whether candidate k
 *      was rejected therefore moved every later candidate.
 *   2. **Randomness.** A rejected candidate consumed 3 draws from the segment's
 *      generator and an accepted one 7 (8 on a residential gali, which also rolls
 *      commercial-ness), so a rejection also shifted every later draw — width,
 *      depth, setback, floors, tint, brick, commercial-ness and even the next
 *      gap.
 *
 * Measured consequence (`docs/SYNTHETIC_ROAD_AUDIT.md`): inserting one 379 m road
 * through the mapped blocks removed **54** buildings, of which only **19**
 * actually conflicted with the new carriageway. The other 35 — 65 % — were
 * re-rolled neighbours, up to 70.9 m from the road.
 *
 * ## What is frozen here
 *
 * For every shipped segment and side, the exact sequence of accept/reject
 * decisions its frontage walk made when the 845-building world was generated
 * (`c60e15b5`). Replaying that sequence reproduces the shipped world byte for
 * byte, and a road added later can then only *turn a building off*: the walk's
 * positions, its draws and every neighbour stay exactly as they were.
 *
 * 1210 steps, 564 of them accepted.
 *
 * ## Regenerating
 *
 * Do **not** regenerate this table by hand. It is captured from a real build by
 * instrumenting the walk. `tests/unit/frontage-isolation.test.ts` fails if the
 * table stops replaying the shipped world (`c60e15b5`, 845 buildings), and also
 * fails if a road added across the city moves a neighbour instead of merely
 * removing the buildings it conflicts with.
 */

/** Decision for one frontage step: `'a'` accepted, `'r'` rejected. */
export type FrontageDecision = 'a' | 'r';

/**
 * `"<segmentId>/<side>"` → one character per walk step, in walk order.
 *
 * Step 0 is at 9.5 m from the segment start; each step advances 4.5 m when
 * rejected and `width + gap` when accepted.
 */
export const LEGACY_FRONTAGE_DECISIONS: Readonly<Record<string, string>> = {
  // asad_0
  'asad_0/-1': 'aaar',
  'asad_0/1': 'aarrr',
  // asad_1
  'asad_1/-1': 'rraa',
  'asad_1/1': 'aaa',
  // asad_2
  'asad_2/-1': 'aaaa',
  'asad_2/1': 'raaa',
  // asad_3
  'asad_3/-1': 'aarrrrr',
  'asad_3/1': 'raaarr',
  // asad_4
  'asad_4/-1': 'aaaarrrr',
  'asad_4/1': 'aaaarr',
  // asad_5
  'asad_5/-1': 'aaaaar',
  'asad_5/1': 'aaaarr',
  // asad_6
  'asad_6/-1': 'aa',
  'asad_6/1': 'rarr',
  // satmasjid_1
  'satmasjid_1/-1': 'aaaa',
  'satmasjid_1/1': 'rrrraar',
  // satmasjid_2
  'satmasjid_2/-1': 'aaaara',
  'satmasjid_2/1': 'rrrraaa',
  // zakir_1
  'zakir_1/-1': 'rrrrrrrrrrrrr',
  'zakir_1/1': 'aaaaarrr',
  // zakir_2
  'zakir_2/-1': 'aaaaaaar',
  'zakir_2/1': 'aaarrrrrrrrrr',
  // zakir_3
  'zakir_3/-1': 'rrrrrraaaa',
  'zakir_3/1': 'rraaaaaar',
  // zakir_4
  'zakir_4/-1': 'aaaarrr',
  'zakir_4/1': 'aaaaaa',
  // zakir_5
  'zakir_5/-1': 'aaaaarrrr',
  'zakir_5/1': 'rrrraaaarrr',
  // zakir_6
  'zakir_6/-1': 'aaaaaaaaa',
  'zakir_6/1': 'aaaaaarar',
  // ring_0
  'ring_0/-1': 'rraaaarrrrrrrrrr',
  'ring_0/1': 'aaaaaaaaar',
  // ring_1
  'ring_1/-1': 'aarr',
  'ring_1/1': 'aaaa',
  // ring_2
  'ring_2/-1': 'rrrrrrrrraaa',
  'ring_2/1': 'aaaaaa',
  // ring_3
  'ring_3/-1': 'raar',
  'ring_3/1': 'aaa',
  // ring_4
  'ring_4/-1': 'raaaaaa',
  'ring_4/1': 'aaaaaa',
  // nurjahan_1
  'nurjahan_1/-1': 'rrrraaaaaaaa',
  'nurjahan_1/1': 'rraaaaaaaar',
  // nurjahan_2
  'nurjahan_2/-1': 'aaaaaarr',
  'nurjahan_2/1': 'rraaaaaaa',
  // nurjahan_w
  'nurjahan_w/-1': 'rrrrraaaaaarrr',
  'nurjahan_w/1': 'aaaaaaaarrr',
  // chanmia_s
  'chanmia_s/-1': 'rrraaaaaaaaaar',
  'chanmia_s/1': 'rrrrrrrrrrrrrrrrrrrrrrrrrr',
  // salimullah_1
  'salimullah_1/-1': 'rrraaaaaaa',
  'salimullah_1/1': 'rraaaaaaaa',
  // salimullah_2
  'salimullah_2/-1': 'aaaaarrrr',
  'salimullah_2/1': 'aaaaaa',
  // salimullah_link
  'salimullah_link/-1': 'rraarrrr',
  'salimullah_link/1': 'rrarrrrr',
  // shershah_1
  'shershah_1/-1': 'rrraaaaaa',
  'shershah_1/1': 'rraaaaaar',
  // shershah_2
  'shershah_2/-1': 'aaaarrrrrr',
  'shershah_2/1': 'aaaarrrrr',
  // shershah_cross
  'shershah_cross/-1': 'rrrarrrr',
  'shershah_cross/1': 'rraarrr',
  // shershah_deadend
  'shershah_deadend/-1': 'rrraaar',
  'shershah_deadend/1': 'rrraarr',
  // tajmahal_1
  'tajmahal_1/-1': 'rraarrrrr',
  'tajmahal_1/1': 'rrrrraaa',
  // tajmahal_2
  'tajmahal_2/-1': 'rrrrraa',
  'tajmahal_2/1': 'aaarr',
  // tajmahal_3
  'tajmahal_3/-1': 'rrraarrr',
  'tajmahal_3/1': 'rraaar',
  // tajmahal_4
  'tajmahal_4/-1': 'rrrrrrrrrr',
  'tajmahal_4/1': 'aaaaa',
  // tajmahal_5
  'tajmahal_5/-1': 'arrrrrr',
  'tajmahal_5/1': 'rraar',
  // aziz_1
  'aziz_1/-1': 'rrraaar',
  'aziz_1/1': 'rrraaar',
  // aziz_2
  'aziz_2/-1': 'aaaarrrr',
  'aziz_2/1': 'aaaaaa',
  // aziz_3
  'aziz_3/-1': 'rrrarrr',
  'aziz_3/1': 'rrrarrr',
  // shahjahan_1
  'shahjahan_1/-1': 'rrrrrrrrraar',
  'shahjahan_1/1': 'rarrrrrrrrrrr',
  // shahjahan_2
  'shahjahan_2/-1': 'aaaaaaaaar',
  'shahjahan_2/1': 'rrrrrrrrrrrrrrrrrrrrrr',
  // shahjahan_3
  'shahjahan_3/-1': 'aaaa',
  'shahjahan_3/1': 'raarrrr',
  // post_shahjahan
  'post_shahjahan/-1': 'raaaaaaarrarr',
  'post_shahjahan/1': 'rrrraaaarrrrrrrrrr',
  // aurangzeb_1
  'aurangzeb_1/-1': 'rrrraaaaa',
  'aurangzeb_1/1': 'raaaaarr',
  // aurangzeb_2
  'aurangzeb_2/-1': 'aaaaarrrr',
  'aurangzeb_2/1': 'aaaaaarr',
  // iqbal_1
  'iqbal_1/-1': 'rrrrarrrrrrrrr',
  'iqbal_1/1': 'aaaaaaa',
  // iqbal_2
  'iqbal_2/-1': 'aaaa',
  'iqbal_2/1': 'arrrrrr',
  // iqbal_gate
  'iqbal_gate/-1': 'aaaaaaaa',
  'iqbal_gate/1': 'rrrrrrrrrrrrrrrr',
  // humayun_1
  'humayun_1/-1': 'rraaaaarrrr',
  'humayun_1/1': 'rrrraaaaaa',
  // humayun_2
  'humayun_2/-1': 'aaaaaaaaarrrrrr',
  'humayun_2/1': 'aaaaaaaaaaaarr',
  // humayun_3
  'humayun_3/-1': 'raaaaaa',
  'humayun_3/1': 'aaaaarrr',
  // humayun_4
  'humayun_4/-1': 'rraaaaaa',
  'humayun_4/1': 'aaaaaarr',
  // humayun_taj
  'humayun_taj/-1': 'rrrrrrarr',
  'humayun_taj/1': 'arrrrrrrr',
  // aurangzeb_humayun
  'aurangzeb_humayun/-1': 'rraaaaaaaaaarrrrrr',
  'aurangzeb_humayun/1': 'rrraaaaaaaaaaaarrr',
  // iqbal_humayun
  'iqbal_humayun/-1': 'aaaaaaaaaaa',
  'iqbal_humayun/1': 'rrraaaaaaaarr',
  // babar_0
  'babar_0/-1': 'rraaaaa',
  'babar_0/1': 'aaaaaar',
  // babar_1
  'babar_1/-1': 'aaaaaaaaaa',
  'babar_1/1': 'aaaaaaaaaar',
  // babar_2
  'babar_2/-1': 'raaaaaa',
  'babar_2/1': 'arrrrrrrrrrr',
  // babar_3
  'babar_3/-1': 'rraaaaaa',
  'babar_3/1': 'aaaaaaa',
  // babar_link_w
  'babar_link_w/-1': 'rrraaarrrr',
  'babar_link_w/1': 'rraaaarrr',
  // babar_link_m
  'babar_link_m/-1': 'rraarrrr',
  'babar_link_m/1': 'rrraarrrr',
  // babar_link_h
  'babar_link_h/-1': 'arrrrrr',
  'babar_link_h/1': 'rrrrarr',
  // babar_link_e
  'babar_link_e/-1': 'aaaaar',
  'babar_link_e/1': 'rrrraarrr',
  // babar_deadend
  'babar_deadend/-1': 'rr',
  'babar_deadend/1': 'rr',
  // bazar_cut_n
  'bazar_cut_n/-1': 'rrr',
  'bazar_cut_n/1': 'rrr',
  // bazar_cut_se
  'bazar_cut_se/-1': 'rrrrrrrrrrrrrrrrr',
  'bazar_cut_se/1': 'rrrrrrrrrrrrrrrrr',
  // krishi_cut_s
  'krishi_cut_s/-1': 'rrrraaar',
  'krishi_cut_s/1': 'rrrrrrrrrrr',
  // krishi_cut_n
  'krishi_cut_n/-1': 'rrrrrrrrrrr',
  'krishi_cut_n/1': 'arrrrrrrr',
  // lalmatia_cut
  'lalmatia_cut/-1': 'rrrarrr',
  'lalmatia_cut/1': 'rrrrrrrr',
  // johuri_bypass
  'johuri_bypass/-1': 'rrrrrrrrrrrrr',
  'johuri_bypass/1': 'aaaaaa',
};

/**
 * Frozen decision for one frontage step, or `undefined` for a segment that is
 * not part of the shipped world (a road added later).
 */
export function legacyFrontageDecision(
  segmentId: string,
  side: -1 | 1,
  step: number,
): FrontageDecision | undefined {
  const seq = LEGACY_FRONTAGE_DECISIONS[`${segmentId}/${side}`];
  if (seq === undefined) return undefined;
  const c = seq[step];
  return c === 'a' ? 'a' : c === 'r' ? 'r' : undefined;
}

/** Number of frozen steps for a segment/side pair (0 when not shipped). */
export function legacyFrontageStepCount(segmentId: string, side: -1 | 1): number {
  return LEGACY_FRONTAGE_DECISIONS[`${segmentId}/${side}`]?.length ?? 0;
}
