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
- **Corrected:** node 3030299890 is *Town Hall Mosque*, a different place from
  the Ring Road Shia mosque and not to be confused with it. An earlier version of
  this document claimed the Shia mosque "has no matching feature in this extract";
  **that was wrong** — it is OSM way 438545522 "Shia Jame Masjid". See section 11.1.

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

- **12 of the 14 `PLACES` markers sat inside the carriageway** (now fixed; see
  section 10). `makePlaceOnSegment` offset by `halfWidth × 0.58`, i.e. *within*
  the asphalt, giving clearances of −1.6 to −2.6 m. These are
  marker/suggested-heading points rather than geometry, so no traffic lane was
  physically blocked — but the positions were wrong and have since been
  corrected after auditing every consumer.
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

## 10. Legacy marker audit (12 relocated, all 14 validated)

`makePlaceOnSegment` offset markers by `halfWidth * 0.58` — *inside* the
carriageway — leaving 12 of 14 markers in a traffic lane (−1.6 to −2.6 m clear).

The counts differ on purpose and should not be conflated:

- **12 markers were relocated.** These are the ones the defect affected; all now
  sit just outside the curb line (`halfWidth + PLACE_CURB_CLEARANCE`, 0.35 m),
  measured at **+0.32 to +0.40 m** of asphalt clearance.
- **2 markers were validated but not relocated.** `bazaar` (Town Hall Bazar) and
  `market` (Krishi Market) are anchored to verified OSM landmarks and never used
  the `0.58 × halfWidth` rule, so they were already correct at **+1.54 m** and
  **+1.21 m**. Re-anchoring them would have broken the geographic accuracy work.
- **All 14 are validated** by `tests/unit/place-frontage.test.ts` and by the
  live `npm run test:geography` gate.

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

## 11. Corridor character: Ring Road and Tajmahal Road (2026-11-08)

### Screenshot review of the 7 committed frames

Reviewed `artifacts/shot-market-*` and `shot-passenger` from `1fa3fae`:

| Aspect | Finding |
| --- | --- |
| Market identity | Strong at eye level. Town Hall's red/gold and Krishi's green boards read clearly with correct Bengali (টাউন হল বাজার, কৃষি মার্কেট), mounted on posts in front of the shutter line. |
| Road clearance | Clean in every frame — no building, cart or board intrudes on asphalt; aerial frames show continuous carriageways between blocks. |
| Building density | Dense and continuous on both sides, 2-6 storeys, with balconies, AC units, awnings and shopfronts. Reads as Mohammadpur. |
| Rickshaw visibility | Good in `shot-passenger` (player rickshaw, passenger, HUD) and `shot-market-townhall-street`. |
| **Weakness found** | The **aerial frames are dominated by blank flat roofs** in the foreground, and the market boards are unreadable from above. Aerials are poor evidence frames; eye-level is the right lens for identity. |
| **Weakness found** | Generic shopfront signs are procedural — correct in style, but meaningless text. Real names now exist on the two corridors (section 11.3). |

### 11.1 A documentation claim that was wrong

An earlier version of this document stated the Ring Road × Tajmahal Road Shia
mosque "has no matching feature in this extract". **That was incorrect.** The
extract contains OSM way `438545522` "Shia Jame Masjid" (`landuse=religious`) at
23.762105, 90.359111 — 7.9 m from Ring Road on `ring_2`, which the city builder
already called the *"Ring Road Shia Mosque Overpass crest"*. It was missed
because the earlier search used a narrow name pattern. Corrected in the registry
and in section 5.

### 11.2 What was wrong with the corridors

Neither corridor had any recognisable landmark. A pre-existing mosque model sat
at (−188, −34): **~48 m from the real Shia Jame Masjid** at (−201.3, 11.8), so
the one existing mosque was in the wrong place on the right road.

### 11.3 What was added (all OSM-sourced)

Structures, merged into the existing per-sector geometry buckets:

| Landmark | OSM feature | Corridor | Built at | Offset from centroid |
| --- | --- | --- | --- | --- |
| Shia Jame Masjid | way 438545522 | Ring Road (`ring_2`) | (−197.4, 1.6) | 10.9 m |
| Mohammadpur Graveyard | way 439202876 | Tajmahal (`tajmahal_4`) | (−49.4, −33.3) | 4.3 m |
| Mohammadpur Eidgah | way 297224497 | Tajmahal (`tajmahal_4`) | (−26.8, −37.5) | 1.0 m |

**Not built, and why:** Tokyo Square (way 367227689, x = −226.5) and Queen's
College (way 293506381, x = −233.1) are real but lie **west of the playable
world edge (−218)**. They are kept in the registry marked `outsideWorld: true`
and no geometry is created, because building there would place structures in
empty void. Ring Road's identity therefore comes from its in-bounds commercial
strip instead.

**Displacement is disclosed, not hidden.** An OSM centroid can sit *inside* the
sidewalk corridor, and a parcel can be pinched between two roads — the Shia
mosque parcel is bounded by Ring Road *and* `krishi_cut_s`, leaving about 1 m of
clear land at the centroid's exact station. Structures keep the feature's
along-road position and are searched across a small window until the whole
footprint clears every corridor, with the seat closest to the real centroid
winning. Every offset is recorded and asserted `<= 22 m` by tests.

**Named storefronts (real businesses, real positions):**

| Board | OSM id | Corridor |
| --- | --- | --- |
| M/S Meer Owshodh Ghar | 6968431046 | Ring Road |
| Dhaka Bakery | 14271010399 | Ring Road |
| Hanif Tehari House | 14271010400 | Ring Road |
| Pitha House | 7145841093 | Ring Road |
| King's Confectionery | 11979021728 | Tajmahal Road |
| Taj Biriyani | 11978971231 | Tajmahal Road |
| Pusti Dairy Farm Sweets & Bakery | 11979111669 | Tajmahal Road |
| Dhakaiya Pharma | 6902633008 | Tajmahal Road |

These OSM features carry a Latin `name` only — no `name:bn`. The board shows the
real name plus a **generic Bengali category word** from the OSM tag
(`shop=bakery` → বেকারি). No Bengali business name is invented, because none
exists in the source.

Corridor street activity is anchored on what each corridor is known for: tea and
snack carts serving mosque/college traffic on Ring Road, produce and tea at the
graveyard/Eidgah end of Tajmahal Road.

### 11.4 A defect the screenshots caught again

Seating the mosque **after** the frontage was generated left it overlapping a
15.25 m building by **5.6 × 2.9 m**. Unit tests could not see this because they
only model road geometry. Fixed by **reserving landmark parcels before any
building is generated**, registering them through the same `addFootprint` the
builder uses (pushing only into `placedBuildings` was not enough — the parcel
broad-phase map is what `canPlaceBuilding` actually queries). After the fix all
three structures report **zero** building overlaps, and `npm run test:geography`
now asserts this permanently.

### 11.5 Performance

Everything added is merged into existing per-sector geometry buckets and the
existing props buckets: **no new draw calls, no new materials, no new geometry
family**. The sign atlas grew from 20 to 30 cells but remains **one texture**.
Measured in the built game (software GL): **169 draw calls**, 277 geometries,
21 textures, 1.03 M triangles at 960×540.

This is a structural argument plus a draw-call count, **not** a frame-rate
measurement. No Android device test was run; no FPS claim is made.

### 11.6 Still not geographically verified

- The Eidgah is modelled as an open paved ground with a low wall and mihrab
  niche. The OSM feature is tagged only `landuse=recreation_ground`; the
  structures on it are stylised, not surveyed.
- The graveyard is a bounding wall plus representative headstones, not a survey
  of individual graves.
- Shopfront fascia boards are placed on the nearest road apron to each shop's
  OSM node. Exact unit frontage is not in the data.
