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

- ~~No browser screenshots were captured.~~ **Resolved.** The repository already
  ships a headless screenshot harness (`tests/e2e/shoot.mjs`) built on
  `@sparticuz/chromium` + `puppeteer-core` with a SwiftShader software GL path,
  and it works here. An earlier session tried `playwright install chromium`,
  which fails on a blocked download, and wrongly concluded screenshots were
  impossible. See section 9 for the frames that were captured and inspected.
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


## 9. Visual verification (2026-11-08)

### How it was captured

Screenshots come from the repo's own harness, not from a downloaded browser:

```
npm run build
npm run shots market:townhall-front,market:townhall-street,market:townhall-air,\
               market:krishi-front,market:krishi-street,market:krishi-air,passenger
```

`tests/e2e/shoot.mjs` gained a `market:<view>` action with six fixed
gameplay-eye viewpoints derived from the verified landmark coordinates, so
frames are repeatable. Output lands in `artifacts/` and is committed as
evidence. Rendering is software GL (SwiftShader), so these frames prove
*geometry and placement*, not frame rate.

### Defects the screenshots found (all fixed)

Neither of these was catchable by the original numeric tests, which is exactly
why the inspection step matters:

| Defect | How it looked | Cause | Fix |
| --- | --- | --- | --- |
| Town Hall board embedded **inside a 12.2 m building** | Board invisible from the street; only the roof line hinted at it | Board was set back a further 2.4 m from the vendor line, straight into the shopfront | Board now shares the proven-clear vendor apron line; added a footprint-vs-building rejection test |
| Krishi board had **a street tree growing through the panel** | Trunk bisecting the sign | Board spot was clear of buildings but not of trees | Board slides along its own frontage to the nearest spot clear of buildings *and* trees |

A third defect was found while fixing those: the first rejection test used the
footprint's axis-aligned envelope, which is far too conservative for a 4.2 m
board lying parallel to a wall — it rejected Town Hall's valid spot and dropped
the board entirely. Replaced with a 3x3 point grid over the oriented footprint,
matching the approach already used by `isFootprintClearOfCorridor`.

### What the frames confirm

- **Town Hall Bazar** — the Bengali board (টাউন হল বাজার / TOWN HALL BAZAR) stands on
  its posts on the sidewalk, in front of the shutter line, clear of the
  carriageway; vendor carts and the general shopfront signage line the frontage;
  buildings form a continuous street wall on both sides; road surface clean with
  no building or cart intrusion.
- **Krishi Market** — green কৃষি মার্কেট / KRISHI MARKET board legible on the
  Humayun Road frontage, clear of the tree that previously cut through it; carts
  on the sidewalk apron; both sides built up.
- **Aerial views** — no building sits in any carriageway or junction; road
  corridors read as continuous asphalt between building blocks.
- **Passenger/mission frame** — a live duty mission resolves and runs
  ("নূরজাহান রোড চায়ের টং", 70 m, timer counting), confirming the marker
  relocation did not break pickup or the HUD.

### Still not verified

- **Android device performance.** No device test was performed and no frame-rate
  claim is made. Software-GL screenshots say nothing about a mid-range phone.
- The generic shopfront signs, awnings and interiors are procedural placeholders;
  they were not audited against real Mohammadpur businesses and are not claimed
  to be geographically accurate.

## 10. Legacy marker audit (all 12 relocated)

`makePlaceOnSegment` offset markers by `halfWidth * 0.58` — *inside* the
carriageway — leaving 12 of 14 markers in a traffic lane (−1.6 to −2.6 m clear).
Markers are now placed just outside the curb line
(`halfWidth + PLACE_CURB_CLEARANCE`, 0.35 m).

Curb line was chosen over mid-sidewalk deliberately: mid-sidewalk is closer to
the building frontage, and the first attempt at mid-sidewalk buried the bus-stand
marker inside a building. The curb line is furthest from the frontage and still
only ~0.4 m from the asphalt.

| id | road | before | after | approach pose |
| --- | --- | --- | --- | --- |
| stand | Asad Avenue | −2.56 | +0.40 | −0.50 |
| bazaar | Asad Avenue | −2.56 | +1.54 | −0.50 |
| tea | Nurjahan Road | −1.81 | +0.39 | −0.50 |
| school | Iqbal Road | −1.76 | +0.34 | −0.50 |
| garage | Sher Shah Suri Road | −1.93 | +0.36 | −0.50 |
| pharmacy | Asad Avenue | −2.56 | +0.32 | −0.50 |
| launch | Satmasjid Road | −2.39 | +0.34 | −0.50 |
| mosque | Ring Road | −2.35 | +0.33 | −0.50 |
| market | Humayun Road | −1.76 | +1.21 | −0.50 |
| bridge | Babar Road | −1.89 | +0.36 | −0.50 |
| library | Tajmahal Road | −1.93 | +0.37 | −0.50 |
| salimullah | Salimullah Road | −1.76 | +0.34 | −0.50 |
| humayun | Humayun Road | −1.76 | +0.34 | −0.50 |
| zakir | Zakir Hossain Road | −1.64 | +0.39 | −0.50 |

Signed distance to the nearest carriageway edge, in metres, measured from the
road graph (negative = inside the asphalt). "Before" is the coordinate the old
`halfWidth × 0.58` rule produced.

`bazaar` is landmark-anchored and was already correct; `market` keeps its
landmark anchor and therefore its larger clearance.

**Why relocation was safe.** Consumers were audited before moving anything:

| Consumer | Behaviour | Risk | Outcome |
| --- | --- | --- | --- |
| Mission pickup/drop | `dist < MISSION.acceptRadius` (5.8 m) | Marker could drift out of reach | Marker sits 0.61 m off the asphalt, so a vehicle passing is ~1.2 m away |
| `placeApproachPose` (debug teleport) | Offsets 2.2 m **along** the road from the marker | After relocation this would land on the sidewalk | Rewritten to use the place's own segment, in the near lane 0.5 m inside the curb |
| Free-ride POI toast | `< 8 m` | Radius covers the new position | Fine |
| Rival encounters | `< 17 m` | Radius covers the new position | Fine |
| Race gates | Snap to carriageway centreline, radius ≥ 10 m | Insensitive to marker offset | Fine |
| Audio vendor proximity | Uses `PLACES` positions | Reads live coordinates | Fine |

A related latent bug was fixed in the same change: the old teleport used
`snapToNearestRoad`, which snaps to whichever centreline is *closest* — near the
Town Hall junction that is a crossing street, **9.24 m** away and therefore
outside the 5.8 m accept radius, so a teleport there could never trigger the
pickup.

**Regression tests added first** (`tests/unit/place-frontage.test.ts`, 72
assertions): every marker must be on the asphalt-adjacent apron, must stay
within `acceptRadius` reach of a vehicle, and its approach pose must land on the
carriageway. These encoded the constraints *before* any coordinate moved.

**Automated live-scene validator** (`npm run test:geography`): boots the built
game headlessly and asserts, against 849 real building colliders, that no place
marker and no market board is inside a building, plus that boards and carts are
off the carriageway. This is what caught the buried board and marker defects.
