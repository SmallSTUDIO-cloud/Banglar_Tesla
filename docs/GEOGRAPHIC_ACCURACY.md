# Mohammadpur geographic accuracy (v0.7.0)

This document records what was actually verified against
`data/mohammadpur/mohammadpur.osm.json` (ODbL 1.0), what was changed, and what
could **not** be verified in this environment. It is deliberately explicit about
uncertainty: the milestone rule is that accuracy is never fabricated.

## 1. Coordinate pipeline

Game world coordinates are a straight projection of WGS84:

```
x = (lon - 90.3646) * 111320 * cos(23.7624°) * 0.36
z = (23.7624 - lat) * 111132 * 0.36
```

Sanity check against the previously documented Chan Miya Housing reference point
(`23.7598997, 90.3580661` → `x ≈ -239.6`, `z ≈ 100.0`) reproduces exactly.

The playable extent is `x ∈ [-218, 242]`, `z ∈ [-256, 248]`.

## 2. Landmark registry

`src/world/landmarks.ts` holds every landmark the game identifies by name. Each
record stores the originating OSM feature id, its type, and its unmodified
lat/lon, plus the projected `x`/`z`.

| Landmark | OSM feature | Type | Game position | Confidence |
| --- | --- | --- | --- | --- |
| Mohammadpur Town Hall Bazar / মোহাম্মদপুর টাউন হল বাজার | 223068917 | way | (64.93, 98.11) | verified |
| Krishi Market / কৃষি মার্কেট | 494999392 | way | (-176.16, -134.28) | verified |
| Geneva Camp / জেনেভা ক্যাম্প | 13990609728 | node | (31.34, -240.03) | verified |
| Town Hall Mosque / টাউন হল মসজিদ | 3030299890 | node | (29.79, 110.02) | verified |

Two provenance gates enforce this automatically, so a hand-tweaked or invented
coordinate fails:

- `tests/unit/landmarks.test.ts` — re-derives `x`/`z` from the stored lat/lon and
  fails on any drift beyond 5 mm.
- `tests/map_import/test_landmark_provenance.py` — parses the TypeScript
  registry and re-checks every feature id, type, lat and lon against the OSM
  dataset (11 cm tolerance, which absorbs centroid rounding but not relocation).

## 3. What was actually wrong before

Both named markets existed as HUD labels but were pinned to arbitrary fractions
along a road segment rather than to real coordinates:

| Label | Old anchor | Real location | Error |
| --- | --- | --- | --- |
| `place.bazaar` "Town Hall Kacha Bazar" | `asad_3` at t=0.68 → (22.3, 111) | Town Hall Market (64.9, 98.1) | ~39 m west, wrong segment |
| `place.market` "Krishi Market Corner" | `ring_3` at t=0.45 → (-210.6, -78.8) | Krishi blocks (-176…-196, -131…-148) | ~55–75 m away, **wrong road** (Ring Road instead of Humayun Road) |

Both are now anchored to the verified features via `makePlaceAtLandmark`, and
place ids were kept stable so existing blacklist race waypoints still resolve.
The regression is pinned by a test asserting `bazaar → asad_4` and
`market → humayun_1`.

## 4. Deciding which side of the road a market is on

Several Mohammadpur POI nodes sit within ~1 m of a road centreline (Town Hall
Market is 1.2 m from Asad Avenue's centreline, i.e. *inside* the carriageway as
modelled). A single point therefore cannot decide which side of the road the
place is on.

Rather than guess, each market polygon's vertices were voted against the nearest
carriageway:

| Feature | Vertices +side | Vertices -side | Result |
| --- | --- | --- | --- |
| Town Hall Market (223068917) | 2 | 11 | **-1** |
| Krishi block Kha (494999392) | 5 | 0 | **+1** |

The Town Hall result is independently corroborated by the Town Hall Bus stop
(12014830074), which sits 8.6 m out on the same side. The resolved side is
recorded in the registry as data, so nothing is recomputed from an ambiguous
centroid at runtime.

Place markers and entrance boards are then placed on the sidewalk apron
(`halfWidth + sidewalk × 0.55`), which puts them **outside** the asphalt while
still reading as the shopfront the player drives past.

## 5. Known OSM data conflicts (documented, not silently resolved)

- **Geneva Camp has two conflicting polygons.** Way 302622554 and node
  13990609728 agree on the established northern location (~23.7684, 90.3652).
  Way 481245650 is a separate polygon ~1 km to the **south** (23.7592, 90.3670)
  carrying the same name. The northern `place=quarter` node was used as the
  settlement centroid because that is the correct feature class for a
  neighbourhood; the southern polygon was **not** used. This is unresolved OSM
  data, not a game decision.
- **The Krishi blocks are not tagged as a market.** Town Hall Market is
  `amenity=marketplace`, but each Krishi block is `building=commercial` and
  carries its market identity only in the name
  ("খ নং কৃষি পণ্যের পাইকারী বাজার"). The registry records this asymmetry rather
  than implying a marketplace tag that does not exist.
- **Deliberate non-claim:** node 3030299890 is *Town Hall Mosque*. It is not
  labelled a Shia mosque — the separate Shia mosque near Ring Road × Tajmahal
  Road is a different place with no matching feature in this extract, even
  though the engine has a `place.mosque` id historically described that way.

## 6. Street activity

`src/world/marketApron.ts` concentrates vendor activity at the two
authoritative bazaars instead of spreading it uniformly over the whole road
graph (which is what the generic prop pass does). It is a pure function so the
placement is testable without building meshes:

- 9 carts per market, spaced 3.1 m along the frontage, on the sidewalk apron;
- mix weighted toward vegetable vans and fruit carts (a Dhaka kacha bazar
  signature), with tea, fuchka and jhalmuri filling gaps;
- every candidate must clear the carriageway by ≥ 1.2 m or it is dropped;
- measured result: 18 carts, minimum asphalt clearance 1.36 m, all within
  8.7–15.5 m of their real OSM feature.

Named Bengali entrance boards (টাউন হল বাজার, কৃষি মার্কেট) are drawn into
dedicated `SignAtlas` cells and mounted on posts at the market frontage. They
are set back 2.4 m behind the vendor line, with a measured 0.75–0.80 m gap to
the nearest cart so nothing interpenetrates.

Generic shopfront signs were restricted to the generic atlas cells
(`SignAtlas.slot` no longer wraps over named boards), so a random shopfront can
never be labelled as a specific market.

## 7. Not verified (be explicit)

- **No browser screenshots were captured.** Chromium could not be downloaded in
  this environment (`playwright install chromium` fails with a download error),
  so the visual result of the new boards, cart clustering and marker moves has
  **not** been inspected. Geometry is validated numerically and by unit tests
  only. This remains outstanding and should be done before the milestone is
  called complete.
- **No Android device test was performed.** Nothing here claims verified
  performance on a mid-range phone.
- Buildings were **not** rewired: `city.ts` already enforces corridor clearance
  (`isFootprintClearOfCorridor`, 0.55 m margin), SAT footprint separation and
  setbacks, so the "no buildings in roads" requirement was already met and was
  left alone rather than rewritten.

## 8. Pre-existing issues found (not introduced here)

- **12 of the 14 `PLACES` markers sit inside the carriageway.** `makePlaceOnSegment`
  offsets by `halfWidth × 0.58`, i.e. *within* the asphalt, giving clearances of
  −1.7 to −2.6 m. These are marker/suggested-heading points rather than
  geometry, and changing them would shift mission pickup positions, so they were
  left untouched. The two new landmark-anchored places are the only ones with
  positive asphalt clearance. Worth revisiting deliberately.
- **`vnext-race-timing.test.ts` was already racing its 5 s timeout.** Measured
  on untouched source at 5.26 s / 5.36 s / 6.99 s across three consecutive runs,
  so it failed intermittently for reasons unrelated to this work. It now
  declares a 60 s timeout matching the simulation it actually performs.
- `src/audio/audio.ts` references a place id `'shia'` that does not exist in
  `PLACES` (the id is `mosque`), so that branch is dead.
