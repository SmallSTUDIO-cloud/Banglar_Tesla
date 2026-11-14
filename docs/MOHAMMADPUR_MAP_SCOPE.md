# Mohammadpur Map Scope

**Status:** boundary established and measured; **provisional**, not authoritative.
**Tool:** `npm run audit:scope` → `scripts/audit-map-scope.ts` → `tools/mapScope.ts`
**Tests:** `tests/unit/map-scope.test.ts` (23 tests)

> ## Read this before quoting any coverage number
>
> Every figure in this document means **"inside OSM way 318722840"**. It does **not**
> mean "inside Mohammadpur Thana". The polygon measures **3.541 km²**, while every
> published area for the thana is **7.44 km² or larger**. The mapped boundary covers
> roughly half the administrative thana at most, so this project must not claim
> full-thana coverage.

---

## 1. The boundary we use

| Field | Value |
|---|---|
| OSM element | **way 318722840** (closed, 130 vertices) |
| Tags | `boundary=administrative`, `admin_level=8`, `place=suburb`, `name=মোহাম্মদপুর`, `name:en=Mohammadpur`, `wikipedia=bn:মোহাম্মদপুর থানা`, `wikidata=Q3347514` |
| Source tag | `Open Cities Dhaka Survey` |
| Version / last edit | **v48, 2026-10-05**, changeset 190048650 (verified live at `https://api.openstreetmap.org/api/0.6/way/318722840.json`) |
| Fetched | 2026-11-08T19:15:39Z, sha256 `5f58df2c…` of the boundary response |
| Licence | **ODbL 1.0** — © OpenStreetMap contributors |
| Retrieval URL | `https://www.openstreetmap.org/api/0.6/way/318722840/full.json` |

The polygon ships inside `data/mohammadpur/mohammadpur.osm.json` under `boundary`,
with its provenance under `source`. Nothing is duplicated into a second file, so the
ring cannot drift away from the data it was fetched with.

### Measured geometry

| Quantity | Value | Method |
|---|---|---|
| Area | **3.541 km²** | shoelace on `projectOsm` world units |
| Area (cross-check) | 3.5442 km² | shoelace on local metres |
| Area (cross-check) | 3.5472 km² | spherical excess, R = 6 378 137 m |
| Perimeter | 9 683 m | projected sum |
| Vertices | 130 | closed ring, first = last |

Three independent methods agree to within 0.2 %. The area figure is not sensitive to
the projection.

---

## 2. Why the boundary is provisional

The element carries `admin_level=8` and `boundary=administrative`, which in Bangladesh
is the thana level — so it is the best *administrative* candidate in OSM. But its
geometry does not match any published thana area:

| Source | Area |
|---|---|
| BBS 2022 census, as reported by Prothom Alo | **7.44 km²** |
| Wikipedia, *Mohammadpur Thana* | 8.23 km² |
| BBS 2022 aggregation cited by Grokipedia | 9.01 km² |
| Banglapedia-derived local history page | 10.62 km² |
| Wikidata Q3347514 / older Wikipedia | 11.65 km² |
| **OSM way 318722840 (this project)** | **3.541 km²** |

The polygon is **48 % of the smallest** published figure and **30 % of the largest**.
It also carries `place=suburb` alongside the administrative tags, which is consistent
with a mapper having traced the densely-mapped *suburb core* rather than the full
thana — Mohammadpur's western reaches toward the Turag and Beribadh are not enclosed.

**Consequences, stated plainly:**

- The boundary is usable as a *clipping rule* because it is sourced, versioned,
  closed and reproducible.
- It is **not** usable as a claim of administrative completeness.
- `MOHAMMADPUR_MAP_SCOPE.md` deliberately does not define "complete" as this polygon.
  Completing Mohammadpur means extending beyond it, and that requires a better
  boundary than OSM currently offers.

### Secondary evidence

- `Mohammadpur Bus Stand` (23.756993, 90.361736) falls **4 m outside** the ring. That
  is a boundary-edge artefact, **not** proof of gross under-coverage — recorded so
  nobody later reads the bus stand as "not in Mohammadpur".
- Landmarks that *are* inside, verified individually: Town Hall Market, Tajmahal Park,
  Japan Garden City, Tokyo Square, Shia Jame Masjid, Dhaka Residential Model College
  Gate, and three `জেনেভা ক্যাম্প` (Geneva Camp) features.

No authoritative alternative polygon was available inside the sandbox's network
policy. Overpass endpoints returned HTTP 502/000, so no competing relation could be
enumerated; the OSM API was reachable and was used for the element itself.

---

## 3. What the boundary is *not*

| Term | Meaning here |
|---|---|
| **Mohammadpur Thana** | Administrative police/upazila unit. Published 7.44–11.65 km². Larger than our ring. |
| **Mohammadpur (neighbourhood)** | The `place=suburb` label. Our ring is plausibly this, not the thana. |
| **Mirpur Road** | An arterial road that passes through Mohammadpur. A road, not the Mirpur neighbourhood. |
| **Mirpur** | A separate area/thana to the north-west. **Out of scope.** |
| **Adabor, Shyamoli, Sher-E-Bangla Nagar, Dhanmondi, Hazaribagh, Kafrul** | Neighbouring thanas. Out of scope, though their boundary roads are legitimately in scope where they run inside our ring. |

Never infer administrative inclusion from a road name, a nearby POI, or a bounding
box. Mirpur Road is in scope only for the section that lies inside the ring —
1,704 m of its 6,747 m.

---

## 4. Current world extent vs the boundary

| Quantity | Value |
|---|---|
| Game graph | 70 segments, **15 337 m** |
| Graph bounding rectangle | 1.789 km² (x −218…242, z −256…248 world units) |
| Graph inside the ring | **15 337 m — 100 %, 70/70 segments** |
| Boundary ring area | 3.541 km² |

**The entire existing world lies inside the documented boundary.** No segment is
outside, so the hand-authored map is legitimately within the provisional Mohammadpur
extent.

---

## 5. Coverage correction — the box figure overstated coverage

The older audit (`tools/roadCoverage.ts`, `npm run audit:roads`) divides the graph
length by OSM road length inside the **graph bounding rectangle**. That rectangle is
1.789 km², roughly half the ring's 3.541 km², so it produces a much friendlier ratio:

| Denominator | OSM drivable inside | Graph | Coverage |
|---|---|---|---|
| Graph bounding rectangle (old audit) | 47 422 m | 15 337 m | **32.3 %** |
| **Boundary ring (this audit)** | **93 551 m** | **15 337 m** | **16.4 %** |

Both computations are correct; they answer different questions. The box figure is
pinned by `tests/unit/road-coverage-audit.test.ts` and is retained as a historical
measurement. **16.4 % is the honest "how much of Mohammadpur have we built" number**,
and it is the one to quote.

### OSM corpus statistics

| Quantity | Value |
|---|---|
| Drivable ways in extract | 1 490 |
| Total drivable length (unclipped) | 260 338 m |
| Ways touching the ring | 665 |
| Drivable length inside the ring | 93 551 m |
| Overpass query rectangle | 3 349 × 2 918 m = **9.772 km²** |

The extract was fetched with a **rectangular** Overpass query 2.8× the ring's area.
That rectangle — not the boundary — is why 1 490 ways exist when only 665 touch the
map. Any importer must clip to the ring, not to `bounds`.

---

## 6. Corridors (in-boundary lengths)

From `npm run audit:scope`:

| Corridor | OSM ways | Total m | **In-boundary m** | Crossing ways |
|---|---:|---:|---:|---:|
| Mirpur Road | 10 | 6 747 | **1 704** | 5 |
| Sher-E-Bangla Road | 3 | 1 780 | **643** | 1 |
| Aurangzeb Road | 2 | 964 | **964** | 0 |
| Asad Avenue | 4 | 2 825 | **2 776** | 3 |
| Ring Road | 4 | 3 590 | **2 174** | 2 |
| Tajmahal Road | 38 | 5 892 | **5 892** | 0 |
| Satmasjid Road | 8 | 2 639 | **649** | 4 |
| Beribadh Road | 4 | 5 877 | **1 786** | 2 |

Long roads are split into many OSM ways — Tajmahal Road is 38 ways totalling 5 892 m,
all inside the ring. The way count is not a defect.

### Mirpur Road — correcting the record

A previous study reported **1 297.2 m** of Mirpur Road. That figure was measured
inside the **old rectangular project box**, not inside any administrative boundary,
and must not be reused as an in-thana result.

- In-boundary length: **1 704 m** of 6 747 m (25 %).
- **5 of 10 ways cross the ring** — Mirpur Road runs out of Mohammadpur, as expected
  for an arterial connecting to Mirpur proper.
- Only the in-boundary section is eligible; the rest is out of scope and must not be
  imported under a Mohammadpur label.

The test suite asserts `inScopeMetres ≈ 1704` **and** that it is *not* ≈ 1297.2, so the
superseded figure cannot silently reappear.

---

## 7. Rules for clipping and classification

1. **Clip to the ring, not to `bounds`.** `bounds` is the Overpass query rectangle.
2. **Clip exactly, never by sampling.** `clipPolylineToRing` splits each edge at every
   ring crossing, so each sub-segment is wholly in or wholly out and one midpoint
   decides it. No tolerance to tune and no dependence on vertex density.
3. **Truncate, do not extrapolate.** A crossing way contributes only its inside
   portion; it is not replaced by a synthetic connector unless that connector is
   explicitly labelled synthetic.
4. **Filter by `driveable`, not by presence.** 1 490 of 1 610 ways are drivable.
5. **Report boundary-crossing ways separately** (`crossingWays`) so a partially
   in-scope corridor is never presented as fully in scope.
6. **Do not name-match to infer scope.** `name` matching is only used to break out
   named corridors for reporting; inclusion is always decided geometrically.

---

## 8. Reproducing

```bash
npm run audit:scope           # human-readable
npm run audit:scope -- --json # machine-readable report
npx vitest run tests/unit/map-scope.test.ts
```

The report is deterministic given the dataset; only `generatedAt` varies. Figures are
pinned by tests, so a map change that moves them fails loudly rather than silently
invalidating this document.

---

## 9. Open questions / next research

1. **Is there a better thana boundary?** OSM has no larger administrative polygon for
   Mohammadpur reachable here. A ward-level composition (Dhaka North wards covering
   Mohammadpur) or a government-published polygon would be needed to reach 7.44+ km².
2. **Which thana boundary do the published figures measure?** BBS 7.44 km² and
   Wikipedia 8.23 km² disagree by 10 %, so even the "authoritative" figures are not
   settled.
3. Until (1) or (2) resolve, treat 3.541 km² as the **implementation** scope and the
   published figures as the **aspirational** scope.
