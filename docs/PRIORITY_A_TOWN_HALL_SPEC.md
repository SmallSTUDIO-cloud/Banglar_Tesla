# Priority A — Town Hall / Asad Avenue market place: implementation spec

**Status: PROPOSAL. Nothing here is applied.** No source, data, geometry or
baseline file was changed to produce this. It exists so the highest-priority
geographic improvement can be approved or rejected on evidence instead of
re-researched.

**Why this is the Priority A candidate:** the audit
(`docs/MOHAMMADPUR_GEOGRAPHIC_AUDIT.md`) found that landmark *anchors* are exact
(≤1.7 cm) but the market areas are single points. Town Hall is the identity
landmark of Mohammadpur and the only one with both OSM polygon geometry and
independent literature describing its form, so it is the best-verified gap.

---

## 1. What is verified today

All figures below were produced by executing `src/world/landmarks.ts` against
`data/mohammadpur/mohammadpur.osm.json`.

| fact | value | source |
|---|---|---|
| landmark id | `town_hall_bazar` | `LANDMARKS` |
| OSM feature | way **223068917**, `amenity=marketplace` | dataset |
| OSM name | "Mohammadpur Town Hall Market" | dataset |
| addr tags | `addr:street = Asad Avenue`, `addr:postcode = 1207`, `addr:city = Mohammadpur, Dhaka` | dataset |
| game position | (64.93, 98.11), frontage `asad_4` | `LANDMARKS` |
| inside its own OSM polygon | **yes** | point-in-polygon |
| polygon area | **5,010 m² = 1.24 acres** | shoelace on projected vertices |
| polygon extent | **134 m E-W × 83 m N-S** | projected vertices |
| polygon vertices | 13 (12 unique, closed ring) | dataset |

**The anchor is correct and must not be moved.** It sits inside the real market
polygon, on its real frontage. Any work here adds *form* around a correct point.

## 2. The geometry, ready to use

Projected with the live `PROJECTION_ORIGIN` (23.7624, 90.3646) and
`scale = 0.36`. Order follows the OSM ring; vertex 12 closes back to vertex 0.

| # | lat | lon | world x | world z |
|---|---|---|---|---|
| 0 | 23.7600244 | 90.3657500 | 42.18 | 95.04 |
| 1 | 23.7600848 | 90.3659331 | 48.90 | 92.63 |
| 2 | 23.7600528 | 90.3659457 | 49.36 | 93.91 |
| 3 | 23.7603489 | 90.3669438 | 85.97 | 82.06 |
| 4 | 23.7600361 | 90.3670673 | 90.50 | 94.57 |
| 5 | 23.7599324 | 90.3666631 | 75.67 | 98.72 |
| 6 | 23.7599828 | 90.3666433 | 74.94 | 96.71 |
| 7 | 23.7599418 | 90.3665191 | 70.39 | 98.35 |
| 8 | 23.7598737 | 90.3665460 | 71.37 | 101.07 |
| 9 | 23.7597752 | 90.3662473 | 60.42 | 105.01 |
| 10 | 23.7597183 | 90.3662698 | 61.24 | 107.29 |
| 11 | 23.7596017 | 90.3659164 | 48.28 | 111.95 |
| 12 | 23.7600244 | 90.3657500 | 42.18 | 95.04 |

The long north edge (0 → 3) is Asad Avenue's own alignment through the market,
which corroborates the photogrammetric claim that the market fronts Asad Avenue
rather than sitting beside it. `asad_4` runs `town_hall (42,106)` →
`asad_post (118,84)`, so vertices 0 and 11 (x ≈ 42–48) bracket that junction.

## 3. RESOLVED (2026-10-29): the two area figures are different scopes

**User decision, binding.** The earlier "conflict" below is not a data
disagreement — the two numbers measure different things and must not be
reconciled:

| figure | what it is |
|---|---|
| **1.24 acres (5,010 m²)** | the currently mapped OSM `amenity=marketplace` **site polygon** (way 223068917) — the bazaar footprint |
| **5.5 acres** | the wider **Town Hall civic-market precinct** from the academic study, which also covers the ward office, mosque, library and playground |

Consequences, now binding:

- **Neither figure establishes the supermarket building footprint.** Do not
  derive a building plan or height from either.
- **Do not construct a 5.5-acre building**, and do not treat 5.5 acres as a
  building dimension in any form.
- The OSM polygon remains the only *mapped* geometry available, so it is the only
  area that may drive ground-level layout.
- Both figures may be cited in prose, but always labelled with their scope.

The original uncertainty is retained below for provenance, marked resolved.

---

## 3a. Original note (superseded, kept for traceability)

| claim | value | source |
|---|---|---|
| OSM `amenity=marketplace` polygon | **5,010 m² (1.24 acres)** | OSM way 223068917, measured |
| literature: supermarket complex | **5.5 acres** | IJSMR paper on Town Hall Bazar |

The two differ by **4.4×**. They are probably describing different things — OSM
maps the mapped bazaar/market area, the paper likely counts the supermarket plot
plus surrounding market grounds — but **I cannot prove which is which, and I will
not split the difference**. Consequences:

- Do **not** size a building from "5.5 acres" and call it verified.
- Do **not** describe the OSM polygon as "the supermarket footprint". It is a
  marketplace *area*, and it contains the bazaar street.
- The bazaar street is independently documented as **500 ft (152 m) long,
  25–10 ft wide, running east-west**. The polygon's **134 m** east–west extent is
  consistent with that street length, which is mild mutual corroboration of the
  polygon's plausibility — nothing more.

## 4. Hard blocker: the building footprint is not in the data

The checked-in extract contains `roads`, `pois`, `boundary`, `boundaryExits`,
`bounds`, `origin` — **no building polygons**. The two-storey supermarket has no
source footprint available offline.

So a faithful building mass requires one of these, and each is a separate
approval:

1. **Re-import OSM building footprints** for the Town Hall block (data change;
   `scripts/import-mohammadpur-osm.py` would need a buildings pass, the dataset
   would grow, and every provenance test would need to stay green).
2. **Model the market area only** from the 12 verified vertices in §2 — no
   invented building envelope, form suggested by grounds + existing procedural
   shop rows — and explicitly *not* claim the supermarket's own mass is modelled.
3. Approve literature-derived dimensions. Not recommended: the only literature
   dimension available is the contested 5.5 acres, and inventing a height/plan
   from it would violate the no-invented-measurements rule.

**Option 2 is the only one I can execute without new data or invented numbers.**

## 5. Baseline gate analysis

Every option above changes world content, so every one needs an explicit
baseline decision **this mission explicitly forbids**:

| change | baseline impact |
|---|---|
| market ground overlay / boundary from §2 vertices | new ground geometry; may or may not enter the 845-building digest — **must be measured, not assumed** |
| any building mass inside the area | new buildings → world baseline **845 / `c60e15b5`** changes |
| removing/reshaping existing procedural shops near it | building count + digest change |
| lane or junction changes (none needed) | 140 lanes / `52306cb0` — **not required, so not proposed** |

Note the good news: **nothing in Priority A requires touching the lane graph,
junctions, race semantics or gameplay.** It is purely additive cosmetic/world
geometry. That makes it cheap to approve later and cheap to verify now.

## 6. Recommended first slice, if approved

Smallest defensible increment, in this order:

1. **Measure first.** Add the §2 ring as a data constant and a unit test that it
   is simple, closed, non-self-intersecting, 5,010 m² ±1 %, and contains
   `town_hall_bazar`. This changes no game output and can land before any
   approval question is settled.
2. **Ground overlay only** from the ring, flat, no buildings. Re-run
   `baseline:update-world` and *report* whether the digest moved rather than
   assuming either way.
3. Only after a baseline decision: procedural low-rise mass inside the ring,
   respecting that the bazaar street crosses it east-west and must stay walkable.

## 7. What not to do

- Do not move `town_hall_bazar`. It is inside the real polygon.
- Do not relabel the market "supermarket". OSM says `marketplace`.
- Do not state 5.5 acres anywhere as a game dimension.
- Do not import buildings as part of this spec without a separate approval.
- Do not claim the Town Hall supermarket is modelled until a footprint exists.

## 8. Open questions for the user

1. The 5.5-acre literature figure vs the 1.24-acre OSM polygon — which governs?
2. Approve an OSM building-footprint import pass, or keep the world
   building-free of surveilled footprints and stay procedural?
3. Is a ground-overlay-only first slice acceptable, or does Priority A require
   the building mass to count as "done"?
