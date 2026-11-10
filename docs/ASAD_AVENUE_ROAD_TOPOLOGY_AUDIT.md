# Asad Avenue road topology audit

**Status: AUDIT AND DESIGN ONLY — no code or geometry changed, nothing committed.**

| | |
|---|---|
| Branch | `arena/f78d620e-banglar-tesla` |
| Baseline | `fc971cd` (Step 1 already reverted) |
| Scope | Two OSM ways, photographic evidence, road-model resolution, architecture, baseline capture |
| Deliverable | This document + `data/mohammadpur/gameplay-baseline.json` (both uncommitted) |

Evidence is tagged **[VERIFIED]** (reproduced from data or a source I actually
read), **[DERIVED]** (arithmetic on verified inputs, assumption stated), or
**[UNKNOWN]**.

---

## 0. Two corrections to my previous report

Both matter, and both came out of this audit.

### 0.1 I had the units wrong

`projectOsm()` in `src/world/landmarks.ts` multiplies by `scale: 0.36`. So the
numbers produced by `tools/snapshot-gameplay.ts` are **game units, not metres**.

**[VERIFIED]** — `projectOsm(23.7599477, 90.3663704)` = `(64.93, 98.11)`, matching
the registry entry `town_hall_bazar (64.9, 98.1)`.

**1 game unit = 1 / 0.36 = 2.778 real metres.**

My Step 1 report said the corridor sits "~12.5 m north". That was **12.5 game
units**, i.e. ~35 real metres. The direction (north) was right; the distance was
understated by 2.78×. The corrected figure is in §4.

### 0.2 The units are deliberately inconsistent — and that's fine

| Quantity | Unit | Evidence |
|---|---|---|
| Node positions (`ax/az/bx/bz`), segment `length` | **compressed game units** (÷0.36) | `projectOsm` applies `scale` |
| Segment `width`, `sidewalk` | **real metres, 1:1** | 49 segments with both fields: game width ÷ OSM `widthMeters` = **median 1.87**, range 1.23–3.00. If widths were compressed the ratio would be ~0.36 |
| Building storey height | **real metres** | `city.ts:968` `floorH = 3.05` |
| Vehicle/canopy dimensions | **real metres** | rickshaw canopy ~0.98 units |

So the world is a **geographically compressed 0.36× map where objects keep full
real-world size**. This explains why roads render proportionally ~1.9× wider
than reality — it is the arithmetic consequence of the compression, and it is
self-consistent. It also means `asad_4`'s `width: 12.2` is **12.2 real metres**,
which is close to a real Asad Avenue cross-section. That is a better result than
I would have guessed, and it changes the recommendation: **the width is roughly
right; it is the direction model and the alignment that are wrong.**

---

## 1. Both OSM ways — verified tags, direction, nodes, connections

### 1.1 Tags [VERIFIED, copied verbatim from `data/mohammadpur/mohammadpur.osm.json`]

Both ways carry an **identical, minimal** tag set:

```
access=yes  highway=secondary  lanes=2  name=আসাদ এভিনিউ
name:bn=আসাদ এভিনিউ  name:en=Asad Avenue  oneway=yes  surface=asphalt
```

| Property | 565418929 | 223068915 |
|---|---|---|
| `name` / `name:en` | আসাদ এভিনিউ / Asad Avenue | আসাদ এভিনিউ / Asad Avenue |
| `highway` | secondary | secondary |
| `lanes` | 2 | 2 |
| `oneway` | yes | yes |
| `surface` | asphalt | asphalt |
| **`width` tag** | **absent** | **absent** |
| Importer's `widthMeters` | 6.0 | 6.0 |
| Importer's `widthSource` | **`estimated:lanes`** | **`estimated:lanes`** |
| Vertices / nodes | 21 / 21 | 19 / 19 |
| Length (game units) | 453.09 | 451.43 |
| Length (real metres) | 1258.6 | 1254.0 |

Important negatives **[VERIFIED]**:

- **Neither way has a `width` tag.** The 6.0 m figure is the importer's
  `lanes × 3.0 m` estimate, not a survey. All carriageway widths below are
  **[UNKNOWN]** at survey accuracy.
- No `dual_carriageway`, no `median`, no `divider`, no `turn:lanes`, no
  `maxspeed` tags on either way.
- **No relation membership** is recorded for either way in this extract. The
  importer's output does not carry `relations`, so relation membership is
  **[UNKNOWN]** from local data — I did not query the live OSM API, so I cannot
  claim they belong to (or are absent from) a route relation.

### 1.2 Direction [VERIFIED by measurement, not by the `oneway` tag]

Node order runs **opposite** between the two ways. Projecting A's vertices onto
B and tracking arc position:

| A vertex | s along A (units) | s along B (units) |
|---|---:|---:|
| v0 | 0.0 | **451.4** |
| v2 | 28.5 | 424.7 |
| v10 | 179.4 | 274.3 |
| v13 | 238.2 | 215.9 |
| v20 | 453.1 | **1.8** |

A's start maps to B's end and vice versa. Overall bearings: **A v0→v20 = 73.5°**
(east-north-east), **B v0→v18 = 253.7°** (west-south-west) — exactly opposed.

### 1.3 Endpoint connections [VERIFIED]

Both ways terminate on **Mirpur Road** (way 506461944 / 1530347555) at the
eastern end and on the Satmasjid Road area at the western end. They do **not
share a single node** with each other.

### 1.4 Perpendicular separation along the corridor [VERIFIED]

All 21 A-vertices projected onto B:

| | separation (**game units**) | separation (real m) |
|---|---:|---:|
| minimum | **2.01** | 5.59 |
| median | **3.01** | 8.36 |
| mean | **3.14** | 8.71 |
| maximum | **4.31** | 11.97 |

> **Corrected in the §10 follow-up.** An earlier revision labelled this column
> "separation (real m)" and then described the values as metres in the prose.
> They are **game units**; real metres are `units / 0.36`. The 2.01–4.31 range
> and the "8.4 m" quoted in §3.2 are the *same measurement in two units*, not a
> contradiction: 3.01 units / 0.36 = 8.36 m.

**In the game's compressed frame the two centrelines are 3.01 units (8.36 real
metres) apart, never more than 4.31 units (11.97 m).** The signed lateral offset
is negative at every sample (range −2.01 to −4.19 units), i.e. **B is
consistently on one side of A** — not a crossing or a weaving pair.

### 1.5 Junction locations — the decisive evidence [VERIFIED]

Six ways touch **both** Asad Avenue ways. Four of them are unnamed stubs only
2.3–3.1 m long:

| Way | Name | Class | Length | A-node | B-node | gap |
|---|---|---|---:|---|---|---:|
| 506461944 | Mirpur Road | trunk | 273.3 | 10026676374 | 6235001291 | 4.39 m |
| 1530347555 | Mirpur Road | trunk | 256.1 | 5445470661 | 6235001292 | 4.58 m |
| 1383483829 | *(unnamed)* | residential | **2.3** | 2320117954 | 12808965986 | 2.33 m |
| 1385714599 | *(unnamed)* | unclassified | **3.0** | 373384581 | 12829638889 | 2.97 m |
| 1385716003 | *(unnamed)* | unclassified | **2.8** | 2320117935 | 12829609089 | 2.77 m |
| 1385716751 | *(unnamed)* | residential | **3.1** | 2320117972 | 12829705348 | 3.15 m |

The two ways also meet **the same named cross-streets at different nodes**:
Nurjahan Road, Salimullah Road, Sher Shah Suri Road, Iqbal Road (twice), Zakir
Hossain Road (twice), Kazi Nazrul Islam Road (twice), Satmasjid Road.

**Interpretation [DERIVED]:** the four ~3 m stubs exist *only* to link the two
parallel lines. That is the signature of a mapper deliberately encoding **one
road as two directionally-split centrelines, with the median between them**. A
duplicated or accidentally-redrawn road would not carry purpose-built 3 m
connectors at every junction.

**But note the caution I was asked to observe:** `oneway=yes` alone proves
nothing, and I have not classified these as "two carriageways" on that basis.
The classification below rests on the *separation* (8.4 m ≈ a median, not a
carriageway pair) plus the *crossover stubs* plus the *photographs*.

---

## 2. Photographic evidence

### 2.1 Access status — read this before trusting anything below

**Both URLs you supplied return "No file by this name exists" [VERIFIED].**
They are missing the underscore delimiters:

| You gave | Actual file |
|---|---|
| `File:Asad_Avenue_-Muhammadpur-_Dhaka_2015-05-30_1430.JPG` | `File:Asad_Avenue_-_Muhammadpur_-_Dhaka_2015-05-30_1430.JPG` |
| `File:Town_Hall_-Mohammadpur_Asad_Avenue-_Dhaka_2015-05-30_1438.JPG` | `File:Town_Hall_-_Mohammadpur_Asad_Avenue_-_Dhaka_2015-05-30_1438.JPG` |

The category page `Category:Asad_Avenue` lists **14 files** **[VERIFIED]**, all
by Biswarup Ganguly, all shot 30 May 2015.

**What I could do:** read the Commons description pages, and view three
photographs at 500 px thumbnail resolution (retrieved via image search; direct
`upload.wikimedia.org` download is blocked in this sandbox — `curl` fails with
`SSL_ERROR_SYSCALL`).

**What I could not do:** open the 6016×4000 originals. So my notes are from
**downscaled thumbnails**, and fine detail (marking widths, kerb heights) is
**[UNKNOWN]** to me. I am not going to pretend otherwise.

### 2.2 Verified file metadata [VERIFIED from Commons description pages]

| File | Date | Author | Licence | Cameras |
|---|---|---|---|---|
| `Asad_Avenue_-_Muhammadpur_-_Dhaka_2015-05-30_1430.JPG` | 30 May 2015, **08:25:20** | Biswarup Ganguly | CC BY 3.0 | 6016×4000 |
| `Town_Hall_-_Mohammadpur_Asad_Avenue_-_Dhaka_2015-05-30_1438.JPG` | 30 May 2015, **08:28:53** | Biswarup Ganguly | CC BY 3.0 | 6016×4000 |

**Neither description page carries a GPS coordinate tag [VERIFIED].** So I
cannot prove from metadata which stretch of the avenue each frame shows — the
filenames and timestamps are all I have, and file order implies the photographer
walked west to east through the sequence 1426→1439.

**Dating caveat:** these are **11 years old** (May 2015 → October 2026). They
establish what Asad Avenue *was*. They do **not** establish current median
presence, current lane counts, or current shopfronts. Anyone using them for
Phase 1 building work must label them as historical.

### 2.3 What the photographs show [VERIFIED — I looked at these three]

**`..._1433.JPG` — "Asad Avenue - Muhammadpur Town Hall Market Area"**

Wide two-way avenue receding to a vanishing point. **A raised, kerbed central
divider runs from the lower-centre of the frame to the vanishing point.** On the
left of it: cycle-rickshaws heading toward the camera, plus a pedestrian.
On the right: a white minivan, a white sedan and a rickshaw heading away. Behind:
two-storey shophouse blocks with projecting Bengali shopboards, a large overhead
billboard (a woman's face), a mature tree canopy on the left, dense overhead
wiring. Pedestrians on both carriageways and along the right kerb.

I cropped and 3×-upscaled the roadway band. The divider is unmistakably **a
raised kerbed island** — you can see the vertical kerb face and the lighter
paving on top, with vehicles passing on both sides. It is not paint.

**`..._1439.JPG` — "Town Hall - Mohammadpur Asad Avenue"**

Lower, closer angle. A **raised kerbed median runs diagonally across the
foreground**, with what appears to be advertising painted on its vertical face.
A white microbus and a green auto-rickshaw on the far carriageway; rickshaws and
a cyclist on the near side. Behind: two-storey shophouses, a large tree with
hanging yellow/green decorations, a mosque minaret silhouetted against the sky.
Overhead billboards.

**`..._1435.JPG` — "Mohammadpur Town Hall Market - Asad Avenue"**

Market area. Broad open asphalt in the foreground with a red sedan, a green
auto-rickshaw at the left edge, rickshaws, hand-pulled carts loaded with goods,
and pedestrians crossing freely. Two-storey market sheds/shophouses behind, a
canopy of orange/red awnings on the right, a vendor stall with produce
bottom-right. Very large overhead billboards on poles. **In this frame I cannot
clearly resolve a median** — the foreground is open asphalt with pedestrians
walking across it. That is consistent with a median *break* at the market
entrance, but the resolution does not let me assert it.

### 2.4 Other files in the category [VERIFIED to exist; NOT viewed]

`Address_Plaque_-_Catholic_Bishops_Conference_of_Bangladesh_-_24C_Asad_Avenue`
(1427), `Address_Plaque_-_Xaverian_House_-_24B_Asad_Avenue` (1428),
`Xaverian_House_-_24B` (1429), `Doreen_Purbachal_-_Residential_cum_Commercial_
Building_under_Construction_-_3-11` (1431), `SFX_Green_Herald_International_
School_Gate_-_24` (1432), `Gate_-_Saint_Francis_Xaviers_Greenherald_..._-_24`
(1434), `Mohammadpur_Town_Hall_Market_-_Asad_Avenue_..._1436`,
`Town_Hall_-_Mohammadpur_Asad_Avenue_..._1439` (viewed),
`St_Joseph_Higher_Secondary_School_-_97_Asad_Avenue` (1426).

**Useful for Phase 1 regardless:** the house numbers cluster at **3–11, 24,
24B, 24C and 97 Asad Avenue**. St Joseph's at 97 and the Xaverian/CBCB complex
at 24/24B/24C are both on Asad Avenue and both appear in this photographic set.
`Category:Saint_Joseph_Higher_Secondary_School` exists as a subcategory with
24 files **[VERIFIED]** — a ready-made reference board for a Phase 1 building,
but I have **not** inspected those images.

---

## 3. Road model resolution

### 3.1 The verdict: **B — two carriageways with a physical central divider**

Evidence for B, in order of strength:

1. **Photographs show a raised kerbed divider** at the Town Hall stretch, in two
   independent frames (1433, 1439) [VERIFIED].
2. **The two OSM ways are 8.4 real metres apart** — far too far to be two
   traces of one centreline (a duplicate would be <1 m), and the right order of
   magnitude for a carriageway–median–carriageway cross-section [VERIFIED].
3. **Four purpose-built 3 m crossover stubs** link them at junctions [VERIFIED].
4. **Opposed node ordering** matching two one-way flows, with consistent lateral
   sign at every sample [VERIFIED].
5. **Left-hand traffic convention is honoured:** B lies to the **right** of A's
   direction of travel at every sample. In left-hand traffic an eastbound
   carriageway should be north of the westbound one. Checking A (bearing 73.5°,
   eastbound) against the projection origin: A sits at lower z = **north**. So
   eastbound-north / westbound-south — correct for Bangladesh [VERIFIED].

**Rejected: A (two directional paths sharing one surface).** Refuted by the
8.4 m separation and, decisively, by the photographs. If no median existed, the
two ways would be within a metre or two.

**Rejected: C (duplicated / unsuitable geometry).** Both ways are complete,
consistent, 1.25 km long, junctioned at the same named cross-streets, and
carrying distinct node sets. There is no evidence of duplication.

**Residual doubt, stated honestly:** I have not verified median presence along
the *whole* corridor (photos cover the Town Hall stretch only), nor current
2026 conditions, nor relation membership. The classification is
**strongly supported for the Town Hall stretch** and **provisionally extended**
to the full corridor on the strength of the OSM separation being uniform
(2.01–4.31 m, mean 3.14, no outliers) across all 21 samples.

### 3.2 Measured cross-section

| Dimension | Value | Confidence |
|---|---|---|
| Centreline-to-centreline separation | **8.4 real m** (median 8.36, range 5.6–12.0) | **[VERIFIED]** |
| Carriageway width, each | **6.0 m** | **[UNKNOWN at survey accuracy]** — importer estimate `lanes(2) × 3.0 m`; no `width` tag |
| Median width | **≈2.4 m** | **[DERIVED]** — 8.4 − 6.0. Only as good as the 6.0 m estimate |
| Kerb-to-kerb total | **≈14.4 m** | **[DERIVED]** — 6.0 + 2.4 + 6.0 |
| Median height / kerb profile | **UNKNOWN** | photos show *raised and kerbed*, no dimension recoverable from a 500 px thumbnail |
| Median continuity (gaps at junctions) | **UNKNOWN** | 1435 hints at a break near the market, cannot confirm |
| Footpath widths | **UNKNOWN** | — |
| Lane counts at junctions | **UNKNOWN** | `lanes=2` is per way, no turn-lane data |

**Provisional cross-section, explicitly provisional:**

```
        north kerb
  |<-- 6.0 m  -->|<-- 2.4 m -->|<-- 6.0 m  -->|
  [  eastbound  ][  raised     ][  westbound  ]  total ≈14.4 m
  [   2 lanes   ][   median    ][   2 lanes   ]
                  (kerbed, ~UNKNOWN height)
        south kerb
```

**Comparison to the game:** `asad_4` is `width: 12.2` — **12.2 real metres**,
against a derived real total of ~14.4 m. That is **85% of the real width**, i.e.
*slightly narrow but defensible*. The current model draws it as **one undivided
bidirectional surface**, which loses the median and the one-way split but keeps
the overall road envelope roughly correct.

**This is the single most useful finding of the audit:** the *width* is not the
problem. Do not "fix" the width. What is missing is the **median and the
direction split**, and what is broken is the **alignment** (§4).

---

## 4. Alignment — the defect that actually blocks Phase 1

Because the two ways are 8.4 m apart, the correct single-centreline target for a
merged game road is **the median between them**, not either way. Step 1 measured
against way 565418929 alone, which is one edge of the road — half the apparent
"error" was an artefact of choosing the wrong reference.

Measured in compressed game units, game Asad nodes vs the **real median**:

| Game node | position | dist to real median (units) | real metres |
|---|---|---:|---:|
| `bus_stand` | (−112, 194) | 17.43 | 48.4 |
| `asad_nurjahan` | (−70, 162) | 17.89 | 49.7 |
| `asad_salimullah` | (−15, 132) | 15.00 | 41.7 |
| `town_hall` | (42, 106) | 13.34 | 37.0 |
| `asad_post` | (118, 84) | 14.39 | 40.0 |
| `asad_iqbal` | (196, 82) | 12.75 | 35.4 |
| `asad_gate_e` | (242, 78) | 14.81 | 41.1 |

**The whole chain sits 12.7–17.9 units (35–50 real m) north of the real
median.** A corridor-wide offset, matching the existing disclaimer's
"hand-placed … straight-line approximation".

### 4.1 The consequence that matters for building work

Two verified landmarks **flip to the wrong side of the road**:

| Landmark (registry, exact) | vs real median | vs current game road | |
|---|---|---|---|
| `town_hall_bazar` (64.9, 98.1) | NORTH | NORTH | ok |
| `town_hall_market` (46.0, 110.8) | **NORTH** | **SOUTH** | **FLIPPED** |
| `town_hall_bus_stop` (61.6, 109.3) | **NORTH** | **SOUTH** | **FLIPPED** |

At the market's x, the real median is at z ≈ 117.6 but the game road is drawn at
z ≈ 104.8 — so the road passes **south of the market building** instead of north
of it. Any building, stall or entrance placed on the "game road's north side"
would land on the **wrong side of the real street**. This independently confirms
your instruction that no building placement may proceed on the unresolved layout.

---

## 5. Architecture: separating geography from authored gameplay

### 5.1 Why the Step 1 change was structurally unsafe, not merely unlucky

`RoadSegment` (`src/world/layout.ts:36`) derives **everything geometric from the
two node coordinates**:

```
ax,az,bx,bz   <- node x,z
length        <- hypot(b - a)
ux,uz         <- unit tangent
leftX,leftZ   <- left normal
halfWidth     <- width / 2
```

So **topology and geometry are a single fused source of truth**. There is no way
to correct a road's shape without also changing its length, its junction
bearings, every neighbouring segment's length, and every value downstream that
multiplies `length`. That is exactly the blast radius measured in Step 1: 9
segments re-lengthed, 11 of 17 race distances changed, 3 of 14 shortcuts
re-priced, 4 markers dragged.

Additional findings from this audit:

- **`RoadSegment` has no `oneWay`, `lanes` or `median` field [VERIFIED].**
  `traffic.ts` has no one-way handling. The whole network is bidirectional. So
  the dual carriageway is not modelled at all — and *cannot* be, in this schema.
- **There is no authored-vs-derived boundary.** Race distances are recomputed
  from geometry on every run (`buildRaceCourse`). Nothing records what a race
  distance was *intended* to be. A geometry edit therefore silently rewrites
  authored design values.
- **Landmark/place anchors are re-projected onto live geometry.**
  `makePlaceOnSegment` (`layout.ts` ~410) clamps `tAlong` and re-derives the
  position. That is why `bazaar`, a *landmark-anchored* marker, moved 10 units
  when an unrelated segment's geometry shifted.

### 5.2 Proposed five-layer separation

```
LAYER 1  GEOGRAPHY (reference, versioned)
  OSM ways, vertices, tags, retrieval hash, per-way direction.
  Read-only. Never authored by hand.
  Purpose: the target to measure against; source for rendered road shape.
        │  one-way, explicit, versioned projection
        ▼
LAYER 2  GAMEPLAY TOPOLOGY (stable IDs, frozen anchors)
  Junctions + edges. IDs never change. Positions are *derived once* from
  Layer 1, then FROZEN and stamped with `alignVersion` + the OSM hash they
  were derived from. Hand-tuning allowed but recorded as a deliberate delta
  with a reason — never an accident.
        │
        ├──────────────► LAYER 3  MOVEMENT
        │                  Traffic/navigation consume topology + a
        │                  cross-section (lanes, direction, median) that is
        │                  its OWN data, not geography. One-way and
        │                  lane-offset behaviour lives here. Defaults derived
        │                  from Layer 1 tags; can be tuned for gameplay
        │                  without touching positions.
        │
        └──────────────► LAYER 4  AUTHORED GAMEPLAY VALUES
                           Race distances, shortcut savings, AI timings,
                           deadlines. Stored as GOLDEN DEFAULTS, not
                           recomputed-and-trusted. A geometry change must
                           produce an explicit diff for human approval.
        ▼
LAYER 5  LANDMARK / BUILDING ANCHORS
  Anchors store an ABSOLUTE (x,z) plus the (segmentId, t) they were authored
  against. Rendering uses the stored absolute position. Re-projection NEVER
  happens automatically; it is a reviewed migration.
```

The load-bearing rules:

1. **Layer 1 is never edited.** Corrections are re-imports, recorded by hash.
2. **Layer 2 positions are frozen.** A geometry correction is a *new
   `alignVersion`*, applied as a reviewed migration that emits a delta report —
   not a silent side-effect of editing a number.
3. **Layer 4 values are compared, not recomputed.** The test asserts *"live
   value equals authored value OR the change was approved"*. Silence is failure.
4. **Layer 5 uses stored absolutes.** This alone would have prevented the 10-unit
   `bazaar` drag and the 17.8-unit `pharmacy` drag in Step 1.

### 5.3 How a geographic correction lands without silently changing gameplay

The mechanism, concretely:

1. Edit `alignVersion` N→N+1 in the geography layer.
2. Re-derive Layer 2 anchor positions. `tools/snapshot-gameplay.ts` emits the
   full new state.
3. Diff against the committed golden snapshot. The diff **must** list every
   changed segment length, place position, course distance and shortcut saving.
4. Layer 4 values that would move are **frozen at their authored value** unless a
   human approves each change. The race deadline is not recomputed from the new
   length; it stays 245 s until someone signs off a new number *with reasons*.
5. Navigation/traffic (Layer 3) adopts the new positions immediately, because
   it has no authored constants to protect.
6. Landmark buildings (Layer 5) keep their stored absolutes; only a reviewed
   migration moves them.

This is the difference between "geometry is corrected" and "the game's difficulty
curve is rewritten by a coordinate tweak".

### 5.4 Architecture options compared

| Option | What it does | Cost | Risk | Verdict |
|---|---|---|---|---|
| **A. Per-segment patches** (what Step 1 did) | Nudge one segment at a time | Tiny per patch | **Unbounded** — every patch re-times shared junctions; measured 11/17 races disturbed by one segment | **Reject** — proven unsafe |
| **B. Whole-corridor re-anchor, no new layers** | Move all 7 nodes to the median at once | Small | Re-times every Asad race at once, still silent; `bazaar`/`pharmacy` anchors still drag | Reject for now — needs Layer 4/5 first |
| **C. Add median + one-way to `RoadSegment`** | Model the dual carriageway properly | Medium-large: touches traffic, nav, races, crossing logic, all consumers of `halfWidth` | High — changes collision width, lane offsets, junction behaviour for every road | Defer — only after A/B/C separation exists |
| **D. Build Layers 1/4/5 first (golden snapshot + frozen anchors + versioned alignment), then re-anchor under review** | Prerequisite infrastructure, then the fix | Small at each step | Low, incremental, each step independently reversible and testable | **Recommended** |

**Recommendation: D.** The decisive argument is that Step 1 already proved a
geometry change *cannot* be evaluated without the golden-snapshot machinery,
because there was no way to tell "expected consequence" from "silent breakage"
other than by hand-diffing 30 KB of JSON — which is exactly what I spent the
last session doing.

---

## 6. Baseline preserved

Captured with the existing harness, unmodified code at `fc971cd`:

```
npx vite-node tools/snapshot-gameplay.ts > baseline.json     # 30,105 bytes
```

Machine-readable copy saved to **`data/mohammadpur/gameplay-baseline.json`**
(31,770 bytes, adds `deadlineSeconds` and `aiReferenceTimesS` to every course)
because `/tmp` does not survive between sessions.

Verified healthy on this tree after capture: **typecheck-clean baseline, 396/396
in 45 files.**

Reproduces the pre-Step-1 state exactly: **70 segments / 42 nodes / 14 places /
17 courses / 14 shortcuts** — byte-comparable to the pre-edit baseline.

### 6.1 The 7 Asad nodes [VERIFIED]

`bus_stand (−112, 194)` · `asad_nurjahan (−70, 162)` · `asad_salimullah (−15, 132)` ·
`town_hall (42, 106)` · `asad_post (118, 84)` · `asad_iqbal (196, 82)` ·
`asad_gate_e (242, 78)`

### 6.2 Asad Avenue segments

| id | from → to | length (units) | width (real m) |
|---|---|---:|---:|
| `asad_0` | `beribadh_w` → `bus_stand` | 56.89 | 11.5 |
| `asad_1` | `bus_stand` → `asad_nurjahan` | 52.80 | 12.2 |
| `asad_2` | `asad_nurjahan` → `asad_salimullah` | 62.65 | 12.2 |
| `asad_3` | `asad_salimullah` → `town_hall` | 62.65 | 12.4 |
| `asad_4` | `town_hall` → `asad_post` | **79.12** | **12.2** |
| `asad_5` | `asad_post` → `asad_iqbal` | 78.03 | 12.0 |
| `asad_6` | `asad_iqbal` → `asad_gate_e` | 46.17 | 12.0 |

### 6.3 Connected cross-streets (12 non-Asad segments on those 7 junctions)

| segment | from → to | length | width |
|---|---|---:|---:|
| `satmasjid_1` | `bus_stand` → `satmasjid_mid` | 66.03 | 11.4 |
| `chanmia_s` | `bus_stand` → `ring_south` | 134.42 | 6.4 |
| `nurjahan_1` | `asad_nurjahan` → `nurjahan_mid` | 111.57 | 8.6 |
| `salimullah_1` | `asad_salimullah` → `salimullah_mid` | 101.65 | 8.4 |
| `lalmatia_cut` | `asad_salimullah` → `zakir_w` | 53.82 | 6.0 |
| `zakir_1` | `town_hall` → `zakir_w` | 74.67 | 6.4 |
| `shershah_1` | `town_hall` → `shershah_mid` | 92.35 | 9.2 |
| `zakir_3` | `asad_post` → `zakir_e` | 86.83 | 7.8 |
| `post_shahjahan` | `asad_post` → `shahjahan_s` | 121.80 | 6.6 |
| `bazar_cut_se` | `shershah_spur_e` → `asad_post` | 91.30 | 5.8 |
| `iqbal_1` | `asad_iqbal` → `iqbal_north` | 86.83 | 8.4 |
| `iqbal_gate` | `asad_gate_e` → `iqbal_north` | 88.77 | 6.4 |

### 6.4 The 14 places

| place | segment | position |
|---|---|---|
| `stand` | `asad_1` | (−105.0, 180.5) |
| `bazaar` | `asad_4` | (67.4, 106.6) |
| `tea` | `nurjahan_1` | (−89.1, 107.0) |
| `school` | `iqbal_1` | (198.1, 34.1) |
| `garage` | `shershah_1` | (33.3, 62.3) |
| `pharmacy` | `asad_4` | (87.3, 86.2) |
| `launch` | `satmasjid_1` | (−77.2, 211.1) |
| `mosque` | `ring_2` | (−216.8, −28.3) |
| `market` | `humayun_1` | (−173.4, −125.9) |
| `bridge` | `babar_2` | (20.0, −237.0) |
| `library` | `tajmahal_3` | (−105.3, −38.8) |
| `salimullah` | `salimullah_1` | (−25.2, 77.9) |
| `humayun` | `humayun_2` | (−61.1, −156.4) |
| `zakir` | `zakir_3` | (110.7, 128.8) |

### 6.5 All 17 courses — distance, deadline, AI reference times

AI times are the deterministic unobstructed simulation used by
`tests/unit/vnext-race-timing.test.ts`. **These are simulation reference values,
not device or human-play measurements.**

| course | kind | distance (units) | deadline (s) | AI times (s) |
|---|---|---:|---:|---|
| `bl_boss_01` | blacklist | 2233 | 270 | 213.5 |
| `bl_boss_02` | blacklist | 866 | 105 | 74.5 |
| `bl_boss_03` | blacklist | 490 | 105 | 50.1 |
| `bl_boss_04` | blacklist | 729 | 105 | 76.1 |
| `bl_boss_05` | blacklist | 979 | 140 | 106.6 |
| `bl_boss_06` | blacklist | 791 | 145 | 109.0 |
| `bl_boss_07` | blacklist | 1010 | 180 | 139.7 |
| `bl_boss_08` | blacklist | 750 | 115 | 87.5 |
| `bl_boss_09` | blacklist | 387 | 88 | 51.9 |
| `bl_boss_10` | blacklist | 591 | 115 | 69.1 |
| `ev_delivery_bazaar` | open-street | 574 | 140 | 96.5 / 100.6 / 104.3 |
| `ev_duel_ring` | open-street | 765 | 185 | 91.0 / 103.2 / 145.3 |
| `ev_pursuit_satmasjid` | open-street | 724 | 150 | 97.1 / 109.7 / 112.6 |
| `ev_shortcut_gali` | open-street | 703 | 155 | 100.7 / 104.2 / 119.0 |
| `ev_sprint_nurjahan` | open-street | 548 | 125 | 67.0 / 71.7 / 93.2 |
| `ev_street_asad` | open-street | **1091** | **245** | 170.9 / 183.1 / 194.6 |
| `ev_survival_jam` | open-street | 439 | 100 | 69.1 / 71.1 / 72.5 |

Note the headroom rule from the test: `minimum = ceil((slowest_AI × 1.2 + 10)/5) × 5`.
At baseline, `ev_street_asad` needs **ceil((194.6×1.2+10)/5)×5 = ceil(243.52/5)×5 = 245**,
against a deadline of **245** — a margin of **exactly zero**.

> **Corrected in the §10 follow-up.** An earlier revision claimed this event has
> "no tolerance for any Asad Avenue lengthening whatsoever" and implied it was
> uniquely fragile. That is wrong in two ways. First, the real tolerance is
> **1.233 s of AI slowdown** (minimum rises to 250 once the slowest racer passes
> `(245−10)/1.2 = 195.833 s`). Second, and more importantly, **13 of 17 events
> sit at exactly zero margin** — this is the normal authored state of the
> codebase, not a special property of `ev_street_asad`. The genuinely tightest
> event is **`bl_boss_08`, with 0.0000 s of slack** (slowest 87.5 s sits exactly
> on its bucket boundary), and that event is *not* on Asad Avenue. See §10.2.

### 6.6 All 14 shortcuts

| shortcut | course | main | shortcut | saving |
|---|---|---:|---:|---:|
| `sc_bazar_gali_10` | `bl_boss_10` | 164.0 | 151.0 | **13.0** |
| `sc_kachabazar_09` | `bl_boss_09` | 164.0 | 92.0 | 72.0 |
| `sc_aziz_08` | `bl_boss_08` | 230.0 | 140.0 | 90.0 |
| `sc_krishi_07` | `bl_boss_07` | 166.0 | 134.0 | 32.0 |
| `sc_bazar_06` | `bl_boss_06` | 256.0 | 184.0 | 72.0 |
| `sc_aziz_05` | `bl_boss_05` | 230.0 | 140.0 | 90.0 |
| `sc_lalmatia_05` | `bl_boss_05` | 229.0 | 134.0 | 95.0 |
| `sc_krishi_04` | `bl_boss_04` | 166.0 | 134.0 | 32.0 |
| `sc_chanmia_03` | `bl_boss_03` | 225.0 | 189.0 | 36.0 |
| `sc_bazar_02` | `bl_boss_02` | 256.0 | 184.0 | 72.0 |
| `sc_krishi_01` | `bl_boss_01` | 166.0 | 134.0 | 32.0 |
| `sc_aziz_01` | `bl_boss_01` | 230.0 | 140.0 | 90.0 |
| `sc_asad_bazar` | `ev_street_asad` | 256.0 | 184.0 | 72.0 |
| `sc_gali_lalmatia` | `ev_shortcut_gali` | 229.0 | 134.0 | 95.0 |

`sc_bazar_gali_10` is the fragile one — a 13-unit saving, i.e. 4.7% of its main
route. Any geometry change that lengthens its main route by >13 units destroys
it.

---

## 7. Risks and expected gameplay impact

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Corridor re-anchor breaks `ev_street_asad` | **Certain** (0 margin today) | Race unwinnable | Must re-author deadline explicitly with approval; never auto-retune |
| `sc_bazar_gali_10` becomes worthless | **High** | Shortcut design lost | Re-derive under review; consider authoring a minimum-saving floor |
| `bazaar` / `pharmacy` markers jump | **Certain** without Layer 5 | Shop markers on wrong buildings | Store absolute anchors before any re-anchor |
| Landmarks land on wrong side of road | **Already true today** (§4.1) | Phase 1 buildings face the wrong way | Block building placement until alignment resolved — matches your instruction |
| Median added to collision model changes drivability | Medium, only if Layer 3 modelled naively | Rickshaw can no longer cross to a shop; junction turns blocked | Median must be **gaps at junctions + crossing points**, and Layer 3-owned, not geometry-owned |
| `halfWidth` consumers assume a single surface | Medium | Kerbs, parked props, building setbacks all offset from `halfWidth` | 14 consumers found in `city.ts` alone; any median work must audit them |
| 2015 photos used as present-day truth | Medium | Buildings modelled to a 11-year-old layout | Label every reference board image with capture date |
| Relation membership unchecked | Low | Route relations unmodelled | Acceptable; note as [UNKNOWN] |

**Expected gameplay impact if the corridor is re-anchored (estimate, not a
measurement):** every Asad Avenue segment length changes by roughly the
projection of a 12.7–17.9 unit lateral shift plus small length adjustments.
`ev_street_asad` (1091 units) and `bl_boss_10` (591) and `bl_boss_09` (387) sit
on this corridor and will all move. **I will not predict the signs or magnitudes** —
Step 1's measured +25/−19/−12 show the sign is not predictable from intuition,
because the chord lengths depend on how lateral moves rotate each segment.

---

## 8. Recommended smallest safe implementation step

**Do this one thing next, and nothing else:**

> **Commit the golden gameplay snapshot and a drift-detection test — pure
> infrastructure, zero behaviour change.**

Concretely:

1. Adopt `data/mohammadpur/gameplay-baseline.json` — already written as part of
   this audit (graph, places, all 17 courses with deadlines + AI reference times,
   all 14 shortcuts). It only needs to be staged.
2. Add `tests/unit/gameplay-baseline.test.ts` that re-runs the snapshot in-process
   and **fails on any difference**, printing a readable per-field diff naming the
   segment/place/course that changed.
3. Wire the AI reference timings from §6.5 into the same golden file so the
   deadline headroom is recorded, not just asserted.

**Why this and not the re-anchor:**

- It touches **no** runtime code. Geometry, traffic, races, missions, saves are
  all untouched. Typecheck/tests/build stay green by construction.
- It is the **prerequisite** for every option in §5.4. Without it, a geometry
  change can only be evaluated by hand-diffing 30 KB of JSON — which is precisely
  the fragile, error-prone process that let Step 1's damage reach 9 segments
  before being caught.
- It converts the Step 1 failure mode ("silent change, noticed late") into a
  **loud, named, immediate failure** — which is the whole point of the standing
  "no silent gameplay changes" rule.
- It is fully reversible: delete two files.

**Explicitly deferred, pending your approval:** the corridor re-anchor itself
(option D's later step), the median/one-way model (option C), and any building
placement. All three depend on §6 being locked down first, and the re-anchor
additionally requires an authored-deadline decision that is yours, not mine.

---

## 9. What I did not do

- **No code or geometry changes.** `mohammadpurData.ts` was not modified.
- **No commits**, no pushes, no releases. This document and the
  `image-search/` thumbnails are untracked working files.
- **No deadline or shortcut retuning.**
- **No building placement.**
- Did not query the live OSM API — tags and geometry come from the committed
  extract (`retrievedAt 2026-11-08`, Overpass SHA recorded in `source`).
  Relation membership is therefore **[UNKNOWN]**.
- Did not open the 6016×4000 originals; photographs assessed from 500 px
  thumbnails only.
- Did not inspect the other 11 Commons files (only metadata confirmed).
- Did not run `bench-street.mjs` — no rendering change was made, so no
  performance claim is warranted.

---

## 10. Follow-up consistency check

A self-audit of the measurements above, run before any baseline commit. It found
**two unit/labelling errors in this document** (both corrected inline and
recorded here), and **one substantive correction** to the deadline analysis.
No conclusion in §3–§5 changes.

### 10.1 Separation reconciliation — 2.01–4.31 vs 8.4

**They are the same measurement in two units.** §1.4's column was mislabelled
"real m"; the values are game units, and `real_m = units / 0.36`.

Method: for each vertex of way 565418929, project onto the polyline of
223068915 with `projectOsm()` and take the perpendicular distance.

| A vertex (units) | nearest B point (units) | d (units) | d (real m) |
|---|---|---:|---:|
| v0 (−110.71, 212.79) | (−106.90, 214.81) | 4.310 | 11.97 |
| v2 (−88.07, 195.51) | (−86.91, 197.15) | **2.013** (min) | **5.59** |
| v9 (−0.47, 140.00) | (0.75, 142.42) | 2.707 | 7.52 |
| v12 (66.89, 108.50) | (67.85, 111.36) | **3.011** (median) | **8.36** |
| v15 (229.21, 92.11) | (229.25, 94.32) | 2.215 | 6.15 |
| v18 (298.19, 88.78) | (298.33, 92.85) | 4.071 | 11.31 |

- 2.01 units → **5.59 m**
- 3.01 units → **8.36 m** ← this is the "8.4 m" quoted in §3.2
- 3.14 units → 8.71 m (mean)
- 4.31 units → **11.97 m**

So: **range 5.59–11.97 real m, median 8.36 real m.** §3.2 is correct; §1.4's
label and prose were not. The classification in §3.1 stands unchanged — a
median gap of 8.36 m between centrelines is still the right order for a
carriageway–median–carriageway section, and still far too large for two traces
of one centreline.

A methodological note worth recording: the two scripts that produced these
numbers used **different projection origins** (the dataset centroid
`23.762923, 90.357411` vs the game origin `23.7624, 90.3646`). That does not
affect the result — the origin is a pure translation and cancels inside a
difference. Only the constant `0.36` factor matters.

### 10.2 Deadline reconciliation — 194.6 s, 245 s and the 250 s

The test rule is `minimum = ceil((slowest_AI × 1.2 + 10) / 5) × 5`, and it fails
when `deadline < minimum`.

**`ev_street_asad`, baseline (pre-Step-1):**

| step | value |
|---|---|
| AI times | 170.9 / 183.1 / **194.6** s |
| slowest × 1.2 | 233.52 |
| + 10 | 243.52 |
| ÷ 5 | 48.704 |
| ceil | 49 |
| **minimum** | **245 s** |
| **authored deadline** | **245 s** |
| **margin** | **0 s** |

**Where 250 came from.** It was never a deadline. After the Step 1 edit the
course grew 1091 → 1116 units and the AI times slowed to 174.3 / 187.9 /
**199.2** s. Then

`ceil((199.2 × 1.2 + 10)/5) × 5 = ceil(249.04/5) × 5 = 50 × 5 = **250 s**`

— i.e. the edit raised the *required minimum* to 250 s while the authored
deadline stayed at 245 s, a **5 s shortfall**. My earlier phrasing ("required
time to 250 s against an authored 245 s deadline") was correct in substance; the
rounding to "250" is an artefact of the test's 5-second bucket, not a measured
completion time.

**Tolerance, stated properly.** The minimum rises to 250 once the slowest racer
passes `(245 − 10) / 1.2 = **195.833 s**`. Baseline is 194.6 s, so the real
tolerance is **1.233 s of AI slowdown** — not zero. The edit cost 4.6 s of AI
time, comfortably exceeding it.

**Correction to §6.5.** "No tolerance for any lengthening whatsoever" was wrong,
and the implication that this event is uniquely fragile was wrong too:

| | count |
|---|---:|
| events at **exactly zero margin** | **13 / 17** |
| events with positive margin | 4 / 17 |
| **tightest slack** | **`bl_boss_08`, 0.0000 s** |
| `ev_street_asad` slack | 1.233 s |

`bl_boss_08`'s slowest racer finishes in exactly 87.5 s, and
`(115 − 10)/1.2 = 87.5` — it sits *precisely* on its bucket boundary, so any
slowdown at all pushes its minimum to 120 s against a 115 s deadline. **That is
a latent fragility unrelated to Asad Avenue**, and it is worth knowing before any
road work anywhere in the graph.

### 10.3 Baseline verified against the exact pre-Step-1 state

Compared by **blob hash** (`git hash-object` vs `git ls-tree`), which bypasses
the index entirely:

| comparison | files | identical | different | missing |
|---|---:|---:|---:|---:|
| working tree vs `a425f88` (**pre-Step-1**) | 409 | **393** | **0** | 16 |
| working tree vs `origin/arena/f78d620e-banglar-tesla` (`fc971cd`) | 411 | **395** | **0** | 16 |

**Zero content differences against the pre-Step-1 commit.** Every source file,
data file and test is byte-identical. The 16 missing entries are all
`artifacts/shot-*.png` screenshots (15 corridor/market shots + `shot-passenger`),
absent from this sandbox's filesystem; they are images, not runtime inputs.

The golden file is therefore provably the pre-Step-1 state, and it re-derives
byte-for-byte:

```
re-run counts : {segments: 70, nodes: 42, places: 14, courses: 17}
nodes MATCH (42) · segments MATCH (70) · places MATCH (14)
landmarks MATCH (9) · courses MATCH (17)
shortcuts: 14
```

### 10.4 Git — fetched, not altered

`git fetch origin` only. **No reset, no rebase, no force-push, no branch change.**
Remote tip verified as `fc971cd` before and after.

Restored local objects: `a425f88`, `fc971cd`, `602b3e1`, `550612f`; new ref
`origin/arena/f78d620e-banglar-tesla`; tags `v0.6.7-test.bench-f8805ce`,
`v0.6.7-test.bench-graphics-baseline`.

**Correcting my previous report.** I said local history had been "flattened to a
single commit". That was wrong. Local `HEAD` is `2dc02d7`, which is the tip of
**`arena/da9a8343-banglar-tesla`** — the session's fork point. The checkout is
sitting one branch-point behind the working branch, so `git status` reports a
large diff that is an artefact of the stale index plus untracked-but-present
files, **not** lost work. All history is intact on the remote.

### 10.5 Untracked files inspected

**`data/mohammadpur/gameplay-baseline.json`** — 31,770 bytes, valid JSON.
Keys: `_note`, `capturedWith`, `counts`, `nodes`, `segments`, `places`,
`landmarks`, `courses`. All 17 courses carry `deadlineSeconds` and
`aiReferenceTimesS`. Provenance header states game units, that `width` is real
metres, and that AI times are simulation values rather than device or human
measurements. Reproducible from `npx vite-node tools/snapshot-gameplay.ts`.

**`docs/ASAD_AVENUE_ROAD_TOPOLOGY_AUDIT.md`** — this file. Sections 0–10.

### 10.6 No runtime, geometry or gameplay data changed

Because the working tree is blob-identical to `a425f88` for every one of 393
tracked files, and 0 files differ, **no runtime source, geometry or gameplay
data has changed.** The only writes made in this follow-up were to this markdown
file. `mohammadpurData.ts` still has no `asad_osm_13` and still carries the
hand-placed-geometry disclaimer.

**Not committed, not staged, not pushed.** Both files remain untracked.

### 10.7 Verification run this session

- `npm test` → **396/396 in 45 files**, 0 failures.
- `npx vite-node tools/snapshot-gameplay.ts` → 30,105 bytes, matches golden.
- Environment notes: `/tmp` does not persist across sessions (so the golden file
  was written into the repo deliberately), and `node_modules` is excluded from
  snapshots and required a fresh `npm ci` this session.
