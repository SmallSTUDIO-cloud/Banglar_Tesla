# Mohammadpur Visual Reference & Research (v0.8.0)

Research document for the authenticity pass. It records **what is verified**, **what is
uncertain**, and **what I could not inspect**.

Every coordinate below is machine-derived from the local OSM extract
`data/mohammadpur/mohammadpur.osm.json` (ODbL 1.0, 1,610 ways / 2,857 POIs) using the
world projection:

```
x = (lon − 90.3646) · 111320 · cos(23.7624°) · 0.36
z = (23.7624 − lat) · 111132 · 0.36
```

Playable extent: `x ∈ [−218, 242]`, `z ∈ [−256, 248]`.

> ### Evidence status of this document
>
> **What I verified directly:** OSM feature ids, feature types, coordinates, tags and
> Bengali/English names, read straight out of the local extract with a script. These are
> reproducible and are gated by `tests/map_import/test_poi_provenance.py`.
>
> **What I verified from published text sources:** historical dates, storey counts, market
> organisation and architectural descriptions, each cited inline below.
>
> **What I could NOT verify — stated plainly:**
> - **I did not view any photograph.** This environment has outbound access only to a small
>   allowlist (GitHub, npm, PyPI). Google Street View, Wikimedia Commons, Facebook and
>   travel-photo sites are unreachable, and `image_search` returned no usable local images
>   for these places. **No photo board is presented, because I could not inspect photos.**
>   Building shapes, colours and signage below are therefore *textually* sourced, not
>   photo-confirmed, and must not be described as photo-matched.
> - **No source states what any specific shopfront looks like** at the level of detail a 3D
>   model needs (exact fascia colours, sign fonts, stall dimensions). Those are marked
>   **UNVERIFIED** wherever they would drive geometry.
> - I did not visit Mohammadpur. Nothing here is from personal observation.

---

## 1. Verified POI registry (15 places)

Generated into `src/world/poiRegistry.ts`. `inside` = within the playable extent.

| # | Place | OSM id | Type | x | z | inside |
|---|---|---|---|---|---|---|
| 1 | Mohammadpur Town Hall Bazar | 223068917 | way | 64.9 | 98.1 | ✅ |
| 2 | Shaheed Park Jame Masjid (Town Hall Mosque) | 3030299890 | node | 29.8 | 110.0 | ✅ |
| 3 | Mohammadpur Town Hall Market (node) | 12014830571 | node | 46.0 | 110.8 | ✅ |
| 4 | Shahid Park Masjid Market | 367594623 | way | 32.5 | 110.7 | ✅ |
| 5 | Town Hall Bus Stop | 12014830074 | node | 61.6 | 109.3 | ✅ |
| 6 | Krishi Market, Block Kha | 494999392 | way | −176.2 | −134.3 | ✅ |
| 7 | Krishi Market, Block Gha | 494999395 | way | −178.1 | −139.1 | ✅ |
| 8 | Shia Jame Masjid | 374712754 | way | −202.0 | 8.2 | ✅ |
| 9 | Tokyo Square | 367227689 | way | −226.5 | −101.7 | ❌ |
| 10 | Geneva Camp | 13990609728 | node | 31.3 | −240.0 | ✅ |
| 11 | Tajmahal Park | 297224783 | way | −74.4 | −104.9 | ✅ |
| 12 | Saat Gumbad Masjid | 1560283156 | way | −206.5 | 187.6 | ✅ |
| 13 | Dhaka Residential Model College | 1008314351 | way | 111.5 | −122.7 | ✅ |
| 14 | DRMC Gate | 1386522766 | way | 46.0 | −58.5 | ✅ |
| 15 | Mohammadpur Bus Stand | 3712961702 | node | −105.0 | 216.3 | ✅ |
| 16 | Mohammadpur Eidgah Field | 297224497 | way | −25.8 | −37.7 | ✅ |

**Tokyo Square is outside the world** (x −226.5 < −218). It appears on the map, marked
NOT CONNECTED YET, and can never generate a route. It is not built in 3D, because building
it would place geometry in empty void outside the playable edge.

---

## 2. Place-by-place notes

### 2.1 Town Hall Bazar and Asad Avenue

- **Verified:** marketplace polygon (223068917) on Asad Avenue; mosque node opposite it
  (3030299890); separate market node (12014830571); bus stop (12014830074).
- **Verified from sources:** established in the **1950s**; a **two-storey** supermarket
  building; the **open-air kacha bazar dates from 1970–71**; the site also holds the ward
  councillor office, a library, a playing field and the mosque; the main bazaar street runs
  **east–west, roughly 500 ft long and 10–25 ft wide**, with the supermarket on its south
  side; it serves both Mohammadpur and Lalmatia; Azam Road and Sher Shah Suri Road meet
  near the mosque/market. ([IJSMR case study](https://ijsmr.in/doc/ijsmr06_103.pdf);
  [ResearchGate case study](https://www.researchgate.net/publication/374943201))
- **Verified from trade description:** sections for vegetables, fish, meat, grocery, fruit,
  electrical/hardware, furniture, plus juice and food stalls; a large parking area; three
  mosques in the bazar area. ([Dhaka bazaars account](https://dhaka-bazar.blogspot.com/);
  [market listing](https://in.worldorgs.com/catalog/dhaka/city-or-town-hall/muhammadpur-town-hall-market))
- **UNVERIFIED:** exact fascia colours, sign typography, stall canopy colour, individual
  shopfront layouts. Any such detail in the 3D build is a stylistic choice, not a record.
- **Design consequence:** the recognisable silhouette is a **long, low (2-storey) market
  block beside a much longer open-air bazaar street**, not a tall building. A 11-storey
  "modern market" appears in one property listing — that is a *proposed redevelopment*, not
  the current building, and must not be built as the present-day site.

### 2.2 Krishi Market and Shia Jame Masjid

- **Verified:** three tagged wholesale-market blocks in the extract — Kha (494999392),
  Gha (494999395), and Cha+Jha (494999396), around x −176…−182, z −134…−148. Shia Jame
  Masjid has both a building polygon with `building=mosque` (374712754) and a `landuse=religious`
  polygon (438545522) around the same site, near Ring Road.
- **Verified from sources:** Krishi Market is a **government** market established **1981**,
  famous for **rice wholesaling**, with ~150 shops; a newer "Notun Krishi Bazar" nearby has
  ~500 shops with separate fish/meat/poultry corners; food restaurants, pharmacies, tea
  stalls and fruit shops line its frontage. ([Dhaka bazaars account](https://dhaka-bazar.blogspot.com/))
- **UNVERIFIED:** the number of storeys on each block, and whether the three tagged blocks
  are physically connected.
- **Design consequence:** model it as a **cluster of low warehouse-scale blocks**, not a
  single landmark tower. The wholesale character matters more than any one façade.

### 2.3 Ring Road, Tokyo Square and Japan Garden City

- **Verified:** Tokyo Square (367227689) is `building=commercial`, **7 levels**, at
  x −226.5 — just **8.5 m outside** the world edge. Its mall node (5477461196) and a
  convention centre (11993579518) sit beside it. Japan Garden City is a set of numbered
  residential blocks (e.g. 297337422 "Bldg No. 07") strung along x −234…−247 — **all
  outside the world edge**.
- **Verified from sources:** Tokyo Square is a shopping centre near Queen's College and the
  agricultural kacha bazar. ([Mapcarta](https://mapcarta.com/N5477461196))
- **Consequence:** **Japan Garden City cannot be built at all** in the current extent;
  eight of its blocks lie beyond x −218. It should be mapped (greyed, NOT CONNECTED), never
  built. Tokyo Square is likewise map-only.

### 2.4 Tajmahal Road and Tajmahal Park

- **Verified:** Tajmahal Park (297224783) is `leisure=park` at (−74.4, −104.9). Tajmahal
  Road is the longest named corridor in the extract (**37 ways**).
- **Verified from sources:** the park is a **DNCC** project with a perimeter walkway,
  benches, a children's play area, an open football/cricket field, lawns and shade trees,
  designed to be wheelchair accessible. ([Vitti, DNCC project page](https://vitti.com.bd/tajmahal-road-park-playground/))
- **Design consequence:** a **flat, green, tree-heavy open space ringed by a path** — the
  opposite of a built landmark. Trees and an open field carry the identity.

### 2.5 Geneva Camp

- **Verified:** node 13990609728 at (31.3, −240.0); two area features (302622554,
  481245650 — the latter at z +127.5 is a *second, different* tagged area; the extract is
  ambiguous here and this is recorded as an unresolved conflict).
- **Verified from sources:** named **1972**; a Bihari settlement; population figures vary
  widely by source (**~30,000 to ~50,000** — an unresolved discrepancy); blocks **A–B** and
  **C–I**; dwellings as small as **8 × 8 ft to 8 × 10 ft**, with **2–3 storey** structures
  built on single small plots; very narrow lanes and staircases; two large mosques, shops,
  two schools and a clinic inside. ([bdnews24](https://bdnews24.com/media-en/image/39b8e9e5293a);
  [Juniper housing study](https://juniperpublishers.com/ttsr/TTSR.MS.ID.555638.php);
  [Daily Waadaa](https://www.dailywaadaa.com/reflections/2026/10/01/the-walled-city-of-dhaka-have-you-heard-of-it))
- **Design consequence:** the recognisable form is **extreme density and vertical
  stacking in very narrow lanes** — low-rise but tightly packed, with almost no setbacks.
  Population and block counts are contradictory across sources, so neither is asserted.

### 2.6 Saat Gumbad Masjid (Seven Domed Mosque)

- **Verified:** `building=mosque`, `building:levels=1`, `tourism=attraction` (1560283156),
  with an adjacent `landuse=religious` polygon (297017570) and a node (14284000801), at
  (−206.5, 187.6).
- **Verified from sources:** provincial **Mughal**, built **c. 1680**, attributed to
  **Shaista Khan**; **seven domes** = three over the main hall plus four over corner
  pavilions; external size **75 ft 2 in × 43 ft 9 in**; internal **47 ft 8 in × 16 ft 4 in**;
  three cusped entrance arches on the east with a larger central one; four two-storey
  octagonal corner pavilions; stands on a raised platform with a low wall and an eastern
  arched gateway; formerly overlooked a river bank.
  ([Archnet](https://www.archnet.org/sites/4134);
  [Beautiful Bangladesh](https://beautifulbangladesh.gov.bd/loc/dhaka/103))
- **Consequence:** this is the one place where **dome count and proportions are
  documented**, so a low-poly model can be genuinely recognisable: three domes on drums,
  four smaller corner-pavilion domes, a rectangular low mass on a plinth.

### 2.7 Dhaka Residential Model College

- **Verified:** campus polygon (1008314351) at (111.5, −122.7); a gate feature
  (1386522766); an on-campus mosque node (4528270300).
- **Verified from sources:** founded **1960**, **52 acres**, **6 residential houses**,
  **5,000+ students**, boys' school and college, walled campus, many playing fields, heavily
  treed. ([Wikipedia](https://en.wikipedia.org/wiki/Dhaka_Residential_Model_College);
  [Mapcarta](https://mapcarta.com/W1008314351))
- **Design consequence:** identity comes from **a walled, green, low-density campus** —
  big trees and open fields — inside an otherwise dense area.

### 2.8 Mohammadpur Bus Stand, Eidgah and others

- **Verified:** bus stand node 3712961702 at (−105.0, 216.3); Eidgah
  `landuse=recreation_ground` + `leisure=playground` (297224497) at (−25.8, −37.7).
- **Verified from sources:** the Eidgah is an open field used for Eid congregations; the
  bus stand is a terminus with heavy school-hour congestion.
- **UNVERIFIED:** shelter/terminal structures at the bus stand — none are mapped, so none
  should be invented.

---

## 3. Road-graph truth (carried over from the previous review)

The 3D road network is **not** OSM geometry. Measured against the extract:

| | Real OSM | Game graph |
|---|---|---|
| Ways | 1,610 | 70 straight segments |
| Length inside playable bounds | 16.2 km | 5.5 km (34 %) |
| Vertices | 8,273 | 42 hand-typed nodes |

Corridors are real (every segment midpoint within 25 m of a real OSM road, median 5 m), but
geometry is straight chords and two thirds of the network is absent. Full measurement and
method: `docs/GEOGRAPHIC_ACCURACY.md` §4a.

**Phase 1 implication:** Asad Avenue's real alignment is the OSM way **565418929**, a
21-vertex polyline. The game's seven `asad_*` segments replace it with chords whose nodes
sit **11.5–16.5 m** off the real centreline (and `beribadh_w` is **58 m** off). Correcting
those nodes to the real polyline is the single highest-value geometry fix available, and it
is exactly what Phase 1 should do.

---

## 4. Sources and their limits

| Source | Used for | Limitation |
|---|---|---|
| Local OSM extract | ids, coords, tags, names | Community-mapped; completeness varies; not a survey |
| IJSMR case study (PDF) | Town Hall history, layout, bazaar street dimensions | Academic/design study; describes pre-redevelopment state |
| ResearchGate bazaar case study | Town Hall function and history | Secondary summary |
| Vitti (DNCC project page) | Tajmahal Park design | Design intent, not as-built |
| Archnet; Beautiful Bangladesh | Sat Gambuj dimensions and history | Historical architecture; current condition not stated |
| Wikipedia; Mapcarta | DRMC, Tokyo Square | Encyclopaedic/derived; corrobated where possible |
| bdnews24; Juniper; Daily Waadaa | Geneva Camp | **Population figures conflict (30k–50k)** |
| Dhaka bazaars blog | Krishi Market 1981, rice wholesale, shop counts | Personal blog; shop counts uncorroborated |

**Not accessed (report, don't pretend):** photographs of any of these places, Google Street
View, Wikimedia Commons, Facebook pages, satellite imagery. Consequently **no claim in the
3D build may be described as photo-verified**.
