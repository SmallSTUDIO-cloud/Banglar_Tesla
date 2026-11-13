# Mohammadpur Town Hall Market — implementation and evidence

Branch: `arena/f78d620e-banglar-tesla` · `main` untouched at `84e79e4`.

This document reports what is built on the Asad Avenue frontage at Town Hall, what is
supported by evidence, and what is still wrong with it. It is written to be read
alongside the screenshots in `diagnostics/townhall/`, not instead of them.

Two passes are recorded here. **Pass 1** (commits `b37ffa6` → `9fe5351`) built the market
geometry. **Pass 2** (this one) made it live, reworked the roofing, shutters and arcade,
and completed the working yard behind the halls.

---

## 1. Where the market is

The world's road skeleton already contained Asad Avenue as segment `asad_4`. Local
coordinates below are road-local `(s, v)`: `s` runs east along the polyline, `v` runs
**north, away from the carriageway** (verified numerically, §7 of the pass-1 notes).

| element | extent |
|---|---|
| authored site envelope | `s 9 → 60`, `v 9 → 29.4` (`TOWN_HALL_SITE`) |
| footpath / apron | `v 9.0 → 11.1` |
| shopfront terrace | `v 11.1`, six bays of `8.0` (`BAY`, `BAYS`) |
| bazaar street (covered spine) | `v 18.1 → 22.3`, width `4.2` |
| covered market halls | `s 18 → 52`, `v 22.3 → 29.4` |
| Town Hall Mosque | `s 13.6`, `v 23.2`; minaret 15 m at `s 11.5`, `v 21.0` |
| working yard | `v 29.65 → 34.6`, compound wall at `v 34.8` |

Verified OSM anchors used for placement: marketplace polygon `way/223068917`
(`amenity=marketplace`, `addr:street=Asad Avenue`, 1.24 acres), the mosque
`node/3030299890`, and the market-row shops in `src/world/storefronts.ts`
(`townhall` corridor).

## 2. What was built — pass 1 (geometry)

`src/world/townHall.ts`, one module, drawn into the sector buckets `buildCity` already
owns. It adds **no draw calls**.

1. **Apron and spine floor** — paving from the kerb back to the halls.
2. **Six-bay shopfront terrace** — bay 1 is a red-brick arcade; bays 2–6 are shuttered
   shops with awnings, three stacked Bengali boards each (the verified OSM board takes the
   main position), a projecting vertical board, upper windows, balcony and railing, AC
   units, rooftop tank and stair headroom. The rear elevation faces the bazaar spine.
3. **Covered market halls** — tin-roofed sheds behind the terrace, arcade piers on the
   bazaar side, the market's own name board.
4. **Town Hall Mosque** — drum, shallow dome, 15 m minaret clearing the 9.3 m terrace.
5. **Kacha bazaar** — two counter rows with produce, tarpaulin hoods, hanging cloth.
6. **Kerbside poles and hoardings** — wires handed to the city's existing sagging-line
   builder via `wirePairs`, plus two pole-mounted hoardings over the kerb.
7. **Bazaar gate** and night glow.

Signage: `CATEGORY_BN` gained `butcher`, `seafood`, `greengrocer`, `supermarket`,
`variety_store`; ten verified OSM businesses were appended to `storefronts.ts`. Typo
preserved deliberately: OSM's own "Townhall FIsh Market".

## 3. What changed — pass 2 (the living market)

### 3a. The bazaar is staffed, by borrowing walkers

The market is static geometry, so "life" had to come from an existing animated system
rather than a second one. `PedestrianSystem` now exposes `setMarketVendorPosts()`; the
market emits **22 posts** (stallholders behind counters, shoppers on the aisle) and the
pedestrian system lends walkers to them.

- **No new meshes.** The crew reuses the same nine instanced parts, so the market still
  costs zero draw calls and zero new materials. A test asserts
  `peds.group.children.length === 9`.
- **No visible teleport.** A post is only claimed by a walker more than 50 units from the
  rider. Walkers are re-pinned in a test to prove the guard actually refuses.
- **The pavement does not empty.** Walkers are borrowed, so the walking population target
  is raised by exactly the crew size — staffing the bazaar thins the pavement, which is
  the intended trade.
- **Spread, not clustered.** Posts are walked on a stride (`k * postCount / wanted`), so
  the same 14 people staff the whole bazaar instead of the first few stalls.
- **Motion.** Stallholders work a reach-and-set cycle on their own clock (independent of
  the walk phase, so they keep moving while the rider is stopped); shoppers face the
  goods and lift an arm.
- Engagement radius 130 units, released past 155 — hysteresis, so a rider parked on the
  frontage cannot flicker the crew.
- Ceiling of 14 so the pavement never empties at the market.

### 3b. The bazaar street was re-laid

The pass-1 cross-section put counters hard against both walls, leaving **no room for
anyone to stand behind them** — the stalls could never look occupied however much was
piled on them. Wall to wall (v 18.1 → 22.3) is now: 0.75 working strip → 0.7 counter →
1.0 aisle → counter → working strip. Counters are planked tops on posts (you can see
under them), goods are heaped in tiers, and each stall has stacked baskets and sacks
behind the counter, a hanging balance scale, cloth bolts on the hood frame, and a ribbed
tin hood on a ridge-and-purlin frame.

### 3c. Roofing

The hall roof was a run of 2.5-unit plates, which read as grey slabs. It is now CI sheet
at ~0.55-unit pitch, crest and pan alternating, plus a ridge capping, an eave gutter and a
warm rusted soffit. **Layering mattered:** a 0.3-thick deck cap was drawn above the
sheets and hid the corrugation completely from the air (visible in the aerial capture);
the deck is now 0.08 thick and sits *below* the sheets.

The spine lean-to gets the same treatment, with the corrugation running **along** the
street rather than across it, so from the aisle the ribs converge as ridge lines instead
of reading as a flat soffit.

### 3d. Shutters, arcade

Roller shutters were flat detail rectangles. They now use the city's corrugated
**shutter bucket** (real shutter texture, metallic response), gained eleven proud slat
ribs, guide rails and a lock housing, and sit in a recessed reveal. Tints were moved near
white because the shutter texture is already dark — mid-grey tints multiplied it to
near-black on the street (observed, then fixed).

The red-brick arcade moved into the **brick bucket**, gained a plinth course, pier
capitals, five-voussoir segmental arches, a string course and a moulded cornice.

### 3e. The working yard behind the halls (item C)

The bare northern area was **measured, not guessed**: in the live build the block north
of the halls holds six generated buildings and **none between s 20 and s 50**. The
mapped marketplace polygon cannot be used as a yard boundary — it straddles Asad Avenue
(vertices run from v −7.5 on the south side to v +11 on the north), so it is a land-use
parcel, not a plot line.

What was built is the work a wholesale food market does, all of it function rather than
invented landmark: packed-earth yard across `v 29.65 → 34.6`, standing water and damp
patches (the World Bank/FAO survey documents both), four delivery lorries backed onto the
loading bays, crate pyramids, sack pallets, tarpaulin-covered goods piles, a refuse skip
(waste handling is a documented gap at this market), a compound wall with gate piers and a
sliding leaf along the open stretch `s 21..50`, and damp/refuse detail.

**Explicitly not built:** any building, mosque, school or landmark in that block. The only
structures are market infrastructure. The compound wall is generic boundary fencing that
exists solely to terminate the built edge; it is not claimed to be a photographed feature.

### 3f. Pedestrians now actually appear

Pass-1 captures were shot by moving **the camera only**. The pedestrian system culls
walkers beyond ~135 units of the *rickshaw* and only staffs the bazaar when the rider is in
the district, so those frames showed an artificially empty market that no player would
see. `capture.mjs` and `perf.mjs` now put the rider on Asad Avenue at the market
(`debugTeleport`, the game's own primitive) before shooting. Every frame in this report is
therefore the arrival state.

## 4. World integrity

`isInTownHallSite` is still the only change to generated-city behaviour.

- **845 → 848 buildings**, digest `c60e15b5` → **`49d542e1` — unchanged by pass 2**.
- **5 suppressed** generated blocks, **8 authored** masses; the other **840 byte-identical**.
- Pass 2 adds **5 prop colliders only** (4 lorries + 1 compound wall): `counts.props`
  390 → 395. Everything else in the golden baseline is identical, and the baseline diff is
  two lines. Accepted with `BASELINE_ACCEPT` carrying that rationale, which is stored in
  `data/mohammadpur/world-baseline.json`.
- **22 stall posts**, all inside the site envelope and clear of every carriageway.

## 5. Circulation and collision

Reproducible audit: `npx vite-node diagnostics/townhall/clearance.ts` (exits non-zero on
failure, writes `clearance.json`):

| check | result |
|---|---|
| colliders centred inside a carriageway, whole city | **0** of 1244 |
| minimum collider-centre distance to a carriageway | **1.02** |
| market-block colliders touching a carriageway | **0** of 23 |
| minimum market-collider distance to a corridor | **0.06** |

No stall, counter, lorry or prop is in a carriageway. Wardrobes of detail sit in the
working strip and the yard, both behind the kerb. The halls remain **solid masses**: this
is a driving game with no on-foot mode, so there is no interior to enter and the vehicle
and chase-camera colliders correctly treat them as opaque.

## 6. Evidence — 10 real browser frames

`diagnostics/townhall/capture.mjs` drives headless Chromium (`@sparticuz/chromium`, no
system browser) against the production `dist/` build and renders ten viewpoints. All are on
the carriageway, the apron or over the block, checked against
`distanceToRoadCorridor(x, z) < 0` so no frame is shot from inside a building.

`diagnostics/townhall/after/` (identical cameras in `baseline/`):

| # | file | position | what it shows |
|---|---|---|---|
| 01 | `01-approach-west` | 49.4, 2.2, 102.8 | approach from the junction, frontage running east |
| 02 | `02-approach-east` | 96.1, 2.2, 91.4 | approach from the Post Office end, kerb hoarding |
| 03 | `03-frontage-street` | 67.0, 2.0, 98.8 | shopfront terrace head-on |
| 04 | `04-bazar-inside` | 81.9, 1.7, 74.4 | down the aisle: stallholders, counters, produce |
| 05 | `05-junction` | 51.0, 2.2, 101.3 | Town Hall junction, three-quarter |
| 06 | `06-market-hall` | 57.4, 1.8, 80.2 | inside the bazaar street, stalls and tin |
| 07 | `07-elevated` | 45.8, 34, 104.9 | over the road: frontage, spine, halls, mosque |
| 08 | `08-aerial` | 84.9, 62, 124.8 | aerial over the market block |
| 09 | `09-north-yard` | 84.9, 20, 45.7 | yard behind the halls: lorries, crates, wall |
| 10 | `10-kerb-activity` | 64.2, 1.9, 96.4 | eye level driving past: heaps, awnings, shoppers |

Both sets report `errors: none`. Live state at capture:
`{ pedestrians: 82, marketCrew: 14, marketPosts: 22 }`.

**The control build.** `baseline/` was re-shot at the same ten cameras from a build with
`buildTownHall` and `isInTownHallSite` stubbed out (`npx vite build` on the stubbed module,
then restored and verified byte-identical). The storefront corpus change is present in the
control, so the pair isolates geometry, not shop-name data.

## 7. Performance

`diagnostics/townhall/perf.mjs`, market vs. the same build with the market stubbed, same
arrival state and cameras:

| view | draw calls | triangles | geometries | programs | crew |
|---|---|---|---|---|---|
| frontage | 166 → **166** | 1,217,881 → 1,248,498 (+2.5 %) | 277 → 277 | 65 | 14 / 69 |
| hall | 120 → **122** | 828,712 → 862,422 (+4.1 %) | 277 → 277 | 65 | 14 / 70 |
| aerial | 206 → **205** | 1,356,071 → 1,388,393 (+2.4 %) | 277 → 277 | 65 | 14 / 70 |

**Zero new draw calls at two of three views, one fewer at the aerial; no new geometries,
no new programs.** The +32 k triangles is the roofing, stall detail and yard, and is
partly offset by the five tall generated blocks the market replaces. For scale, that is
~2–4 % of a scene that is already 1.2–1.4 M triangles, in the same buckets the renderer
was drawing before.

**Caveat, stated plainly:** the `meanFrameMs` values (1.2–1.4 s) come from Chromium's
SwiftShader CPU rasteriser. They are **not** device measurements and must not be quoted as
Android performance. Only draw calls, triangles, geometries and program counts are a
meaningful device proxy. **No real-device test was run for this milestone.**

## 8. Recognizable / inaccurate / needs improvement

**Recognizable now.** Shuttered bays under stacked Bengali boards with slanted awnings;
the brick arcade with arches and a cornice; the mosque's minaret clear of the terrace; the
kerbside poles and sagging cables; the corrugated bazaar spine with two counter rows;
**stallholders working behind their counters and shoppers on the aisle**; the working yard
with lorries at the loading bays; and the crowd plus passing rickshaws and buses on the
road.

**Inaccurate / still weak.**
- Vendors are the shared pedestrian rig — no bazaar-specific clothing, and no hand
  gestures beyond the reach cycle. They are convincing at 10–20 m, plain at 2 m.
- Nothing is *carried*: a shopper stands at a counter but produce never leaves it.
- The bazaar underside is still bright and slabby in the aisle frames; the two stall hoods
  nearly meet overhead and read as a ceiling.
- The terrace's rear elevation is better but still flat compared with the shopfront side.
- Produce colours are more saturated than the reference photographs.
- The compound wall and gate are plausible infrastructure; they are **not** a photographed
  feature of this market and should not be described as one.
- The ground north of the yard is still empty (it is outside the authored site), and the
  1.24-acre mapped parcel is still not the 5.5-acre precinct.

**Next, in priority order.** (1) bazaar lighting — a warmer, dimmer soffit and a couple of
hanging bulbs would do more for "busy market" than any more geometry; (2) vendor-specific
dress and a handcart or two in the aisle; (3) carried goods / a loading cycle at the
counters; (4) more legible per-shop Bengali beyond the ten verified names.

## 9. Gates

Run at the committed tree:

| gate | command | result |
|---|---|---|
| types | `npx tsc --noEmit` | 0 errors |
| unit/integration | `npx vitest run` | **674 passed / 65 files** |
| map import | `python3 -m unittest discover -s tests/map_import` | OK |
| APK pipeline | `python3 -m unittest discover -s tests/apk_pipeline -p 'test_*.py'` | OK |
| production build | `npm run build` | **378.01 kB gzip** |
| clearance | `npx vite-node diagnostics/townhall/clearance.ts` | pass, exit 0 |
| captures | `node diagnostics/townhall/capture.mjs … after` | 10 shots, `errors: none` |
| render cost | `node diagnostics/townhall/perf.mjs with-market` | §7 |

`tests/unit/town-hall.test.ts` now has **15 tests**: the pass-1 delta pins plus the living
market — posts exist in both roles, every post is inside the site and off the road, posts
span both stall rows, posts are deterministic across builds, the crew costs no meshes,
the crew engages at the market and releases when the rider leaves, the 50-unit guard
refuses walkers standing in front of the rider, and the five yard props are pinned by
coordinate.

One honest note on the test budget: a full `buildCity` takes ~4.2 s in this sandbox, so
the four-build isolation test carries the 60 s timeout already used elsewhere in its file.
No assertion was weakened or skipped.

## 10. Not done

- No release, tag or APK rebuild. `main` is untouched and nothing was merged.
- **No device performance measurement.** Numbers here are draw calls, triangles,
  geometries and programs plus software-rasteriser frame times (§7).
- No interior to the halls, no vendor character models, no carried goods.
