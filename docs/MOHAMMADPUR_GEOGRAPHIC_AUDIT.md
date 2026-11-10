# Mohammadpur five-layer geographic audit

**Status:** research/documentation only. No source, gameplay, lane-graph or baseline
file was modified to produce this document.

**Date:** 2026-10-29
**Baseline world:** 845 buildings / `c60e15b5`; lane graph 140 lanes / `52306cb0`.
**Dataset:** `data/mohammadpur/mohammadpur.osm.json` (3.92 MB),
`status: "source-derived-preview; not a surveyed map"`.

All figures below were produced by executing the real runtime modules
(`src/world/layout.ts`, `src/world/landmarks.ts`, `src/ai/routes.ts`) against the
checked-in OSM dataset through `vite-node`. Nothing here is estimated by eye.

---

## 0. Method and the one measurement that matters

The runtime world is built by projecting latitude/longitude with
`PROJECTION_ORIGIN = { lat0: 23.7624, lon0: 90.3646 }` and `scale = 0.36`
(world units per metre). `1 world unit = 1 / 0.36 = 2.7778 m`.

**Verification that the projection is correct:** all nine entries in `LANDMARKS`
carry a source `lat`/`lon`. Re-projecting each one and comparing it to the
stored world position gives a maximum error of **0.006 world units = 1.7 cm**.

| landmark | stored (x, z) | re-projected | delta |
|---|---|---|---|
| town_hall_bazar | 64.9, 98.1 | 64.9, 98.1 | 0.004 |
| krishi_market | -176.2, -134.3 | -176.2, -134.3 | 0.004 |
| geneva_camp | 31.3, -240.0 | 31.3, -240.0 | 0.001 |
| town_hall_mosque | 29.8, 110.0 | 29.8, 110.0 | 0.006 |
| shia_jame_masjid | -201.3, 11.8 | -201.3, 11.8 | 0.001 |
| tokyo_square | -226.5, -101.7 | -226.5, -101.7 | 0.006 |
| queens_college | -233.1, -139.8 | -233.1, -139.8 | 0.003 |
| mohammadpur_graveyard | -50.6, -37.5 | -50.6, -37.4 | 0.005 |
| mohammadpur_eidgah | -25.8, -37.7 | -25.8, -37.7 | 0.003 |

**Conclusion: the *coordinate system* is not the problem.** Landmarks are placed
with survey-grade fidelity to their OSM source. Any geographic weakness in this
document is about *coverage and road geometry*, not about the projection.

### A provenance discrepancy that is not a defect

The OSM JSON stores its own `origin` of **23.76292 / 90.35741**, which is
**734.7 m away** (732.4 m west, 58.2 m south) from the runtime
`PROJECTION_ORIGIN`. Nothing in `src/` or `tools/` reads the JSON origin — the
only reader is a report string in `scripts/import-mohammadpur-osm.py:412` — so
this cannot affect runtime coordinates. It is a **reproducibility gap in the
import script** (a future re-import could compute projected coordinates against a
different origin than the one the game uses). It is recorded here as a finding,
not fixed, because changing `PROJECTION_ORIGIN` would translate the entire world.

---

## 1. Geographic layer — extent and network coverage

| quantity | game world | OSM source (same bbox) |
|---|---|---|
| graph extent | 460 u × 504 u = **1,278 m × 1,400 m** | — |
| road segments | **70** | 1,610 ways (1,490 drivable, 573 named) |
| graph nodes | **42** | — |
| total road length | **5,521 u = 15,337 m** | **47,422 m** drivable, box-clipped |
| named places | **14 `PLACES`**, 9 `LANDMARKS` | 2,857 POIs (1,201 of them inside the box) |

**Network coverage: 32.3 %** of in-box OSM drivable length is represented by the
runtime graph. The playable world covers **1.79 km²**, which is **24 % of
Mohammadpur thana's 7.44 km²**.

*Measurement note.* The in-box length must be **clipped** to the box: summing
whole ways that merely touch it gives 260.34 km, which is meaningless overcount.
Clipping with Liang–Barsky over all 1,490 drivable ways gives 47.42 km.

Segment classes: `main` 13, `medium` 34, `gali` 23.

**This ratio is the headline number for any coverage claim.** Mohammadpur is
*not* complete, and the remaining 68 % should not be described as decoration
debt — it is absent street network.

`src/world/mohammadpurData.ts` carries its own header claim of "5.5 km against
16.2 km real, i.e. ~34 % of network length". **The ratio reproduces (32.3 % vs
34 %) but the absolute length does not (47.42 km vs 16.2 km)** — the header
appears to count a narrower road set (excluding service/living_street and
unnamed ways). Because the ratio agrees, the header's *conclusion* stands; the
absolute figure should not be quoted. Recorded, not silently "corrected", since
the extract may have been regenerated since that comment was written.

### High-class corridors inside the playable box

Thirteen named trunk/secondary/tertiary corridors cross the box, **9,244 m** in
total (box-clipped). Presence in the runtime graph:

| corridor | class | in-box | in game |
|---|---|---|---|
| Asad Avenue | secondary | 2,122 m | yes |
| **Mirpur Road** | **trunk** | **1,297 m** | **ABSENT** |
| Aurangzeb Road | tertiary | 964 m | yes |
| Shahjahan Road | tertiary | 896 m | yes |
| Ring Road | secondary | 741 m | yes |
| Tajmahal Road | tertiary | 716 m | yes |
| (unnamed links) | secondary_link | 709 m | absent |
| Sher-E-Bangla Road | tertiary | 660 m | absent |
| Mohammadpur Beribadh Connecting Road | secondary | 595 m | absent |
| Satmasjid Road | secondary | 265 m | yes |
| Sher-E-Bangla Main Road | tertiary | 104 m | absent |
| Glass Factory Road | tertiary | 103 m | absent |
| Sadek Khan Road | tertiary | 72 m | absent |

*Note on the Beribadh row:* the game does have an `asad_0` segment named
"Beribadh Connecting Rd", but it cites way `565418929` (Asad Avenue's way), not
any "Mohammadpur Beribadh Connecting Road" way — so the corridor itself is
unrepresented and the similarly-named segment is not a match.

**The single largest geographic gap is Mirpur Road**: the highest-class road in
the dataset (`trunk`, 1,297 m inside the box) has no representation at all. The
game is currently built *behind* it — Asad Avenue, Ring Road and the Beribadh
edge are all present, but the trunk that carries the traffic into them is not.

This is a *speed-never-overrides* issue: the street hierarchy the game models is
internally consistent, but the trunk that would give it a mouth is missing.

**Blocked, not attempted.** Adding a Mirpur Road corridor necessarily changes
segment count, node count, the **140-lane graph**, and all three golden
baselines. That is inside the P3 / lane-subdivision approval gate and was not
touched.

---

## 2. Road layer — how the graph relates to OSM

Two distinct populations, and the distinction matters for every future claim.

- **49 of 70 segments cite a real `osmWayId`.** For these the OSM way supplies
  identity, name, class and width provenance.
- **21 of 70 segments cite no OSM way** — synthetic connectors that exist to
  make the graph traversable (`zakir_2`, `zakir_5`, `zakir_6`, `ring_0`,
  `chanmia_s`, `salimullah_link`, `aziz_1`, `aziz_3`, `post_shahjahan`,
  `humayun_taj`, `aurangzeb_humayun`, `iqbal_humayun`, `babar_link_w`,
  `babar_link_m`, `babar_link_e`, `bazar_cut_n`, `bazar_cut_se`, `krishi_cut_s`,
  `krishi_cut_n`, `lalmatia_cut`, `johuri_bypass`).
  These 21 account for **32.0 % of total graph length**.

A third of the drivable network the player experiences is invented linking
fabric. That is a legitimate design decision for a small open world, but it must
be stated whenever the map is described as "Mohammadpur".

### Two different geometry questions, two different answers

These must not be conflated, because they are often quoted as if they were one.

**(a) Are the corridors real?** Distance from each segment midpoint to the
**nearest point on any** drivable OSM road polyline (true point-to-segment
distance, not vertex distance):

| statistic | value |
|---|---|
| minimum | 0.3 m |
| **median** | **12.2 m** |
| p90 | 31.7 m |
| maximum | 52.6 m |
| within 25 m | **57 / 70** |
| within 50 m | 68 / 70 |

So the corridors trace real streets — 57 of 70 midpoints are within 25 m of a
real road, and the worst is 52.6 m. **Yes, the corridors are real.**

The header of `mohammadpurData.ts` claims "every one of the 70 segment midpoints
lies within 25 m of a real road polyline (median 5 m)". **That does not
reproduce.** Measured against all 1,610 ways the result is identical to the
drivable-only result (median 12.2 m, 57/70 within 25 m); measured at **nodes**
instead of midpoints it is median 10.4 m, 38/42 within 25 m, worst 44.1 m
(`bus_stand`, `babar_e`, `asad_gate_e`, `asad_iqbal`). No reasonable method
yields "all 70 within 25 m, median 5 m" against the checked-in extract. Either
the extract changed after that comment, or the method is not reproduced here.
**Flagged for the user; not edited**, because I cannot prove which of those is
true and the user's rule is to investigate rather than overwrite.

**(b) Is the cited OSM way the geometry source?** No — and this is by design, not
a defect. Comparing each segment midpoint to the OSM way its own `osmWayId`
names:

| deviation | value |
|---|---|
| minimum | 9 m |
| 25th percentile | 30 m |
| **median** | **78 m** |
| 75th percentile | 140 m |
| 90th percentile | 202 m |
| maximum | 368 m |

Only **12 of 49** segments sit within 30 m of their cited way, and **20 of 49**
are more than 100 m away. All **42 graph nodes have integer coordinates** and no
node carries an OSM node ID, which confirms the graph is hand-authored on a unit
grid rather than derived from OSM.

This is consistent with the source's own documented intent: *"the `osmWayId`
records which way the corridor came from. Road geometry is not [real]."* The way
ID is **identity/width provenance**, not a geometry claim, so the 78 m median is
the expected consequence of hand-placed chords — it is the size of the P3 gap,
not evidence of a bug. Measure **(a)** is the one to quote for "are the streets
real"; measure **(b)** is the one to quote for "how far is P3 from alignment".

Per-segment length ratios are not a useful metric (Ring Road way 33832973 is
640.9 m of OSM geometry represented by four game segments; Asad Avenue way
565418929 is split across seven), but the split structure is visible: **15 OSM
ways are shared by two or more game segments**.

**Conclusion: the road layer is a stylised schematic anchored at exact
landmarks.** Road geometry is the P3 real-alignment work, explicitly out of
scope. This audit records the size of that gap — median 78 m — so that P3 can be
scoped against a number instead of an impression.

---

## 3. Visual layer

- 5,521 world units of carriageway, 845 buildings (baseline `c60e15b5`).
- 42 distinct road names are drawn on the in-game map.
- Road surface, kerbside, trees and junction views were verified pixel-identical
  in the P2 migration (slices 5–8, zero world drift).

**Spot-checked this session** with a transient puppeteer harness (built app,
`vite preview`, `debugStartMode('free')`, `debugSetPhase('golden','sunny')`,
`ui.show(null)`, fixed manual cameras, static frames). Four street-level views
plus one overview, **0 page errors**, all rendered as expected:

| view | camera (world) | what it shows |
|---|---|---|
| `v-asad` | eye (26, 9, 108) → (118, 5, 84) | Asad Avenue east toward `asad_post`: continuous carriageway, kerbs, balconies, power lines, sun, HUD toast |
| `v-bazaar` | eye (52, 7, 110) → (78, 3, 96) | Town Hall bazaar street: shopfront signage, awnings, kerbside stalls, pedestrians, tree cover |
| `v-edgenorth` | eye (10, 12, -170) → (10, 6, -256) | the built edge: buildings stop and bare terrain runs to the horizon — the world boundary is *visible* here |
| `va-aerial1` | eye (0, 150, 300) | overview: dense built fabric with the schematic grid of streets legible |

Two honest observations from the renders:

1. **Distance fog is heavy.** An aerial at 240 units altitude washes the city to
   near-flat tan, and at 430 units the frame is a single unbroken orange — the
   camera is above the fog ceiling entirely. Street level (the actual gameplay
   view) is unaffected and sharp. This is a deliberate trade for a 1.3 × 1.4 km
   world on mobile GPUs, but it means **no aerial/satellite-style validation of
   network coverage is possible from a render** — the 32.3 % figure in §1 comes
   from geometry, not from a picture, and should not be "confirmed" visually.
2. No rendering defect was found on any existing corridor. The visual gap is
   entirely *absence* of streets (§1), not quality of what is built.

Screenshots are transient (`artifacts/` is gitignored, never committed).
Reproduce by rebuilding and re-creating the harness; it is not checked in.

---

## 4. Landmark layer

**9 `LANDMARKS`**, each `confidence: verified`, each within 1.7 cm of its OSM
projection: Town Hall Bazar, Krishi Market, Geneva Camp, Town Hall Mosque, Shia
Jame Masjid, Tokyo Square, Queen's College, Mohammadpur Graveyard, Mohammadpur
Eidgah.

Against 1,201 OSM POIs inside the playable box, **14 `PLACES` (9 landmarks) is
0.75 % of available POI density**. The gaps that matter most for identity, all
absent as first-class features:

- **Mirpur Road** — see §1.
- **Dhaka Residential Model College** — 52 acres, 1960, ~5,550 students.
  Outside the current box; would require world expansion.
- **Saat Gumbad Masjid** — c. 1680, Shayesta Khan; exterior 75'2" × 43'9",
  three bays, three bulbous domes, four domes over two-storey octagonal corner
  pavilions, east façade of three cusped arches, on a buttressed 15-ft bank.
  Absent; documented in enough detail to be modelled faithfully later.
- **Tajmahal Road park/playground** — DNCC walkway/benches/lawns project.
- **Town Hall supermarket** — the 1950s two-storey structure at the middle of
  Asad Avenue, 5.5 acres, forming the north façade of the 500 ft bazaar street.
  `town_hall_bazar` is a point; the building mass is not separately modelled.

### One naming discrepancy (documented, not changed)

The game labels `babar_*` segments **"Babar Road"**. OSM names the same road
**"Babor Road"** (22 ways, all tagged `Babor Road` / `Babor Road, Block # B`).

Not renamed, deliberately: `Babar` is baked into node IDs (`babar_w`,
`babar_mid`, `babar_humayun`, `babar_e`), segment IDs (`babar_0`…`babar_3`,
`babar_link_*`), race-route refs (`babar_humayun`, `babar_mid`), i18n keys
(`place.bridge`) and `mohammadpurData.ts` labels. "Babar" is also a valid
transliteration of বাবর, and legitimate external usage of the name Babar Road
exists. Renaming a user-visible label on ambiguous transliteration evidence
without sign-off is not warranted. Flagged for the user.

---

## 5. Navigation layer

| check | result |
|---|---|
| `PLACES` routable to a road within `POI_ROAD_MAX_OFFSET_M` | **14 / 14** |
| `LANDMARKS` routable as map POIs | **9 / 9** |
| segments with at least one lane | **70 / 70** |
| lanes per segment | 2 everywhere (min 2, max 2) |
| total lanes | **140** (`52306cb0`, unchanged) |

Navigation coverage is **complete for everything that exists**: every place and
landmark is reachable, and no segment lacks lane topology. The navigation gap is
therefore not a routing bug — it is entirely inherited from the geographic gap in
§1. The 1,187 in-box POIs that are not `PLACES` are unreachable simply because
they are not in the game.

PLACES offsets from their road are all 4.3–7.6 units (12–21 m), comfortably
inside the routable threshold.

---

## 6. What this audit establishes

1. **Projection and landmark fidelity are sound** (≤1.7 cm). Do not touch them.
2. **The corridors are real but the geometry is schematic.** Segment midpoints
   sit a median **12.2 m** from the nearest real road (57/70 within 25 m), so the
   streets are correctly chosen. But only a median **78 m** from the OSM way each
   one cites, because the `osmWayId` is identity provenance, not geometry. 32 %
   of network length is synthetic connectors. That 78 m is the P3 scope.
3. **Network coverage is 32.3 %** (box-clipped), area coverage 24 % of the thana.
4. **Mirpur Road is the highest-value missing corridor** and cannot be added
   without changing the 140-lane graph and all three baselines.
5. **Navigation is complete for existing content**, so no navigation fix is
   indicated.
6. **Mohammadpur must not be described as complete** on any of geographic,
   visual or navigation grounds.

## 7. Approval gates this audit ran into

| proposed improvement | why blocked |
|---|---|
| add Mirpur Road corridor | changes segment/node count → 140-lane graph + all 3 baselines |
| realign roads to OSM (median 78 m) | P3 real OSM alignment, explicitly unapproved |
| add DRMC / Saat Gumbad Masjid / Tajmahal park | new geometry + buildings → world baseline 845 / `c60e15b5` |
| rename Babar → Babor | user-visible label, ambiguous transliteration, touches IDs |
| fix import-script origin reporting | cosmetic provenance only; no runtime effect |

Every one of these requires explicit approval. None was attempted.
