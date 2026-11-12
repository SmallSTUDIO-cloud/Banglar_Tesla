# Mohammadpur Town Hall Market — implementation and evidence

Branch: `arena/f78d620e-banglar-tesla` · base `2dc02d7` · `main` untouched at `84e79e4`.

This document reports what was built on the Asad Avenue frontage at Town Hall, what is
supported by evidence, and what is still wrong with it. It is written to be read
alongside the screenshots in `diagnostics/townhall/`, not instead of them.

---

## 1. Where the market is

The world's road skeleton already contained Asad Avenue as segment `asad_4`. Local
coordinates below are road-local `(s, v)`: `s` runs east along the polyline, `v` runs
**north, away from the carriageway** (verified numerically, see §7).

| element | extent |
|---|---|
| authored site envelope | `s 9 → 60`, `v 9 → 29.4` (`TOWN_HALL_SITE`) |
| footpath / apron | `v 9.0 → 11.1` |
| shopfront terrace | `v 11.1`, six bays of `8.0` (`BAY`, `BAYS`) |
| bazaar street (covered spine) | `v 18.1 → 22.3`, width `4.2` |
| covered market halls | `s 18 → 52`, `v 22.3 → 29.4` |
| Town Hall Mosque | `s 13.6`, `v 23.2`; minaret 15 m at `s 11.5`, `v 21.0` |

Verified OSM anchors used for placement: marketplace polygon `way/223068917`
(`amenity=marketplace`, `addr:street=Asad Avenue`, 1.24 acres — the *building* site, not
the 5.5-acre precinct), the mosque `node/3030299890` ("Town Hall Mosque",
`denomination=sunni`, `air_conditioning=yes`), and the market-row shops listed in
`src/world/storefronts.ts` under the `townhall` corridor.

## 2. What was built

`src/world/townHall.ts`, one module, drawn into the sector buckets that `buildCity`
already owns. It adds **no draw calls** (§6). Sections:

1. **Apron and spine floor** — paving from the kerb back to the halls.
2. **Six-bay shopfront terrace** — bay 1 is a red-brick arcade with solid piers, arch
   heads and a spandrel band; bays 2–6 are shuttered shops with a ribbed roller shutter,
   one open dark bay per shop, a slanted awning, three stacked sign boards (the verified
   OSM board takes the main position), a projecting vertical board at the party wall,
   upper windows, balcony slab and 5-bar railing, AC units, rooftop water tank and stair
   headroom. The rear elevation faces the bazaar spine.
3. **Covered market halls** — long tin-roofed sheds behind the terrace, sawtooth roof,
   arcade piers on the bazaar side, upper window band, and the market's own name board.
4. **Town Hall Mosque** — drum, shallow dome and a 15 m minaret that clears the 9.3 m
   terrace behind it, which is the silhouette in the 2015 Commons photograph.
5. **Kacha bazaar** — two rows of counters with produce heaps (baskets, cones, crates,
   per-stall `mulberry32` so the arrangement is deterministic), tarpaulin hoods, hanging
   cloth bolts, support posts.
6. **Kerbside poles and hoardings** — poles at the corridor edge, wires handed to the
   city's existing sagging-line builder via `wirePairs` (no second wire system), plus two
   large pole-mounted hoardings over the kerb.
7. **Bazaar gate** and night glow (emissive quads on the sign band).

Signage: `CATEGORY_BN` gained `butcher`, `seafood`, `greengrocer`, `supermarket`,
`variety_store`; ten verified OSM businesses were appended to `storefronts.ts`
(`sf_th_pharma` … `sf_th_veg`). Typo preserved deliberately: OSM's own "Townhall FIsh
Market". Names legible from the street are only these ten; the rest of the boards are
atlas-generated Bengali, which is honest filler rather than a claim about a specific shop.

## 3. How the generated city was kept out of it

`isInTownHallSite(x, z)` is checked in `canPlaceBuilding`, so the generator no longer
raises blocks on the market ground. That is the only change to generated-city behaviour.

Measured delta, by diffing the golden baseline against the live build on
`x,z,width,depth,height`:

- golden 845 → live **848** buildings; digest `c60e15b5` → `49d542e1`.
- **5 suppressed** generated blocks: `(65.42,81.92) 17.53×16.09 h9.15`,
  `(78.71,80.44) 12.94×10.99 h12.2`, `(91.22,75.71) 16.54×14.16 h18.3`,
  `(45.91,76.62) 10.43×9.84 h9.15`, `(52.33,85.86) 15.05×15.35 h15.25`.
- **8 authored masses**: six terrace bays `9.63×8.95` (heights 6.2 / 9.3), the market
  hall `34.63×16.27 h6.4`, the mosque `6.88×6.74 h4.0`.
- All other 840 buildings are byte-identical.

The baseline was updated with `BASELINE_ACCEPT` carrying that rationale; the reason
string is stored inside `data/mohammadpur/world-baseline.json`. The five suppressions are
the justified local change the milestone allowed — the site is now authored, not generated.

## 4. Circulation and collision

- **No collider centre sits inside any carriageway**: swept over the whole city, minimum
  distance from a collider centre to a carriageway is **1.02** (≈ 2.8 m with the 1.8 m
  half-width), so the Asad Avenue frontage stays drivable along its full length.
- Every authored footprint passes `isFootprintClearOfCorridor(..., 0.55)`.
- The market is on the **north** frontage with `s` increasing eastward; the road is
  `oneway=yes` with `sidewalk=left` in OSM, and the authored shopfronts face the
  carriageway accordingly.
- No stall, counter, basket or prop is placed in a carriageway. The bazaar street and the
  apron are inside the site envelope, behind the kerb.
- The halls are **solid masses**. This is a driving game — there is no on-foot mode, so
  there is no interior to enter; the vehicle collider and the chase-camera clearance both
  treat the hall as opaque, which is correct for how the player meets it.

## 5. Evidence

`diagnostics/townhall/capture.mjs` drives a real headless Chromium
(`@sparticuz/chromium` + `puppeteer-core`, no system browser), serves the production
`dist/` build over `http://127.0.0.1:4211`, and renders eight authored viewpoints. All
eight are on the carriageway or the apron and were checked against
`distanceToRoadCorridor(x, z) < 0` so no frame is shot from inside a building.

Shots, `diagnostics/townhall/after/` (identical camera positions in `baseline/`):

| shot | position (x, y, z) | what it shows |
|---|---|---|
| `01-approach-west` | 49.4, 2.2, 102.8 | approach from the junction, frontage running east |
| `02-approach-east` | 96.1, 2.2, 91.4 | approach from the Post Office end, kerb hoarding |
| `03-frontage-street` | 67.0, 2.0, 98.8 | shopfront terrace head-on from the carriageway |
| `04-bazar-inside` | 82.5, 1.65, 73.2 | down the centre of the bazaar aisle |
| `05-junction` | 51.0, 2.2, 101.3 | Town Hall junction, three-quarter view |
| `06-market-hall` | 57.4, 1.8, 80.2 | inside the bazaar street, stalls and tin roof |
| `07-elevated` | 45.8, 34, 104.9 | over the road: frontage, spine, halls, mosque |
| `08-aerial` | 84.9, 62, 124.8 | aerial over the market block |

Both sets report `errors: none`.

**The control build.** The `baseline/` set was captured from a build in which
`buildTownHall` and `isInTownHallSite` are stubbed out (`npx vite build` on the stubbed
module, restored afterwards and verified byte-identical by SHA-256). The storefront
corpus change *is* present in the control, so the before/after pair isolates the geometry
addition, not the shop-name data. An earlier baseline set existed but had been shot from
camera positions that were since replaced; it was discarded rather than kept as a
misleading comparison.

## 6. Performance

`diagnostics/townhall/perf.mjs` samples `renderer.info` at three of the viewpoints.
Market vs. the same build with the market stubbed out:

| view | draw calls | triangles | geometries | programs |
|---|---|---|---|---|
| frontage | 162 → **162** | 1,196,889 → 1,203,027 (+0.5 %) | 277 → 277 | 65 |
| hall | 117 → **117** | 810,684 → 816,820 (+0.8 %) | 277 → 277 | 65 |
| aerial | 182 → **182** | 1,333,019 → 1,339,231 (+0.5 %) | 277 → 277 | 65 |

Zero new draw calls: the market draws into the six existing sector buckets via an
internal `pick(layer, x, z)` resolver. About 6.1 k extra triangles, and five tall
generated blocks were removed.

**Caveat, stated plainly:** the `meanFrameMs` values in these JSON files come from
Chromium's SwiftShader CPU rasteriser (1.8–3.3 s/frame). They are **not** device
measurements and must not be quoted as Android performance. Only draw calls, triangles,
geometries and program counts are meaningful as a device proxy.

## 7. Recognizable, inaccurate, needs improvement

**Recognizable.** Shuttered shopfront bays under stacked coloured Bengali boards with
slanted awnings; the red-brick arcade closing the east end; the mosque's 15 m minaret
standing clear of the terrace; rooftop tanks on the mid-rises; kerbside poles carrying
sagging cable runs along the frontage; the tin-roofed bazaar spine with two rows of
counters, produce heaps and hanging cloth; the minaret and dome visible down the bazaar
aisle; and the existing pedestrian system still walking the Asad Avenue kerb around it.

**Inaccurate.**
- The hall roof reads as a few large plates rather than fine corrugation.
- Shop interiors are one dark panel; there is no shelving, no vendor, no light inside.
- Nothing moves *inside* the bazaar: the stalls are static geometry and the pedestrians
  walk the road kerb, not the aisle.
- The open ground north of the halls is largely bare. The real precinct is 5.5 acres with
  more built fabric behind the halls; only the 1.24-acre mapped site is authored, and the
  distinction was a deliberate, recorded decision.
- Produce colours are more saturated than the reference photographs.

**Needs improvement, in priority order.** (1) finer roof corrugation and a warmer
underside, since two of the eight frames are dominated by a grey tin soffit; (2) vendor
figures and handcarts in the aisle, reusing the existing pedestrian meshes; (3) shutter
slat depth and a dirt/graffiti layer, so shutters read at close range; (4) more legible
per-shop Bengali beyond the ten verified names.

## 8. Gates

Run at the final tree state:

| gate | command | result |
|---|---|---|
| types | `npx tsc --noEmit` | 0 errors |
| unit/integration | `npx vitest run` | **667 passed / 65 files** |
| map import | `python3 -m unittest discover -s tests/map_import` | OK |
| APK pipeline | `python3 -m unittest discover -s tests/apk_pipeline -p 'test_*.py'` | OK |
| production build | `npm run build` | 1,322.09 kB / **375.55 kB gzip** |
| captures | `node diagnostics/townhall/capture.mjs diagnostics/townhall/after after` | 8 shots, `errors: none` |
| render cost | `node diagnostics/townhall/perf.mjs with-market` | §6 |

`tests/unit/town-hall.test.ts` pins the delta so it cannot drift silently: the five
suppressed blocks by centre and height, `848` / `49d542e1`, the eight authored masses to
three decimals, no collider centre inside a carriageway, every footprint clear of the
corridor, and the market's north-frontage orientation.

One honest note on the test budget: the authored market raises a full `buildCity` from
~3.8 s to ~4.2 s in this sandbox, which pushed one four-build test in
`building-rng-isolation.test.ts` past Vitest's 5 s default. Its timeout was raised to the
60 s already used elsewhere in that file. No assertion was changed, weakened or skipped.

## 9. Not done

- No release, tag or APK rebuild. `main` is untouched and nothing was merged.
- Device performance was **not** measured. The only numbers here are draw calls,
  triangles, geometries and programs plus software-rasteriser frame times (§6).
- No interior for the halls, no vendor characters in the bazaar, no animated stall
  activity — listed above as improvement items, not as completed work.
