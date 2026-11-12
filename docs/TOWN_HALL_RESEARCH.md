# Mohammadpur Town Hall — visual research

**Status:** research complete, implementation not started at the time of writing.
**Purpose:** what the real Town Hall Market looks like, what can be verified, and how
the game's existing world constrains a faithful reconstruction.

Everything below is tagged:

| tag | meaning |
|---|---|
| **[V]** | verified — photograph, OSM tag, or the project's own OSM extract |
| **[P]** | proposal — an architectural *redesign* concept, not the built market |
| **[?]** | uncertain — not corroborated by a source I could reach; do not build on it |

Sources are listed in §8. Coordinates are given in world units (as the game uses)
and in metres where a real-world dimension is meant; 1 world unit = 2.778 m
(`WORLD_SCALE = 0.36`).

---

## 1. The market building — shape, floors, facade, entrances

### 1.1 Footprint [V]

OSM way **223068917**, `amenity=marketplace`, `name=Mohammadpur Town Hall Market`,
`addr:street=Asad Avenue`, `addr:postcode=1207`. Version 6, last edited 2018-09-25.
It is a 12-node closed polygon. Projected through the project's own
`projectLatLon()` (origin 23.7624 / 90.3646) the vertices are:

```
 42.18,  95.04     48.90,  92.63     49.36,  93.91     85.97,  82.06
 90.50,  94.57     75.67,  98.72     74.94,  96.71     70.39,  98.35
 71.37, 101.07     60.42, 105.01     61.24, 107.29     48.28, 111.95
```

| measured | value |
|---|---|
| bounding box | 134.2 m × 83.0 m |
| polygon area | **5 010 m² ≈ 1.24 acres** |
| centroid | (64.93, 98.11) — the value already in `landmarks.ts`, reproduced exactly |
| long axis | roughly WNW–ESE, parallel to Asad Avenue |

This settles a long-standing conflation: the **1.24-acre OSM site polygon is not the
5.5-acre civic precinct** claimed in the IJSMR paper [V-vs-P]. The market *building*
site is 1.24 acres; "5.5 acres" is the wider Town Hall compound figure from a design
paper and is **not** used for geometry here.

### 1.2 Massing and floors [V, partly ?]

The photographs show, along Asad Avenue, a continuous **two- and three-storey**
commercial terrace: closed steel shutters at street level, signboards stacked two to
three high across every bay, and residential floors above with small windows, AC
units and projecting balconies. One block presents a **red-brick arcade with arched
openings** at ground level (file 1439), which is the most architecturally distinctive
element in the whole set.

The IJSMR paper describes the market as a **two-storey 1950s supermarket** [V-source,
? for current state]. OSM carries three shop nodes whose address is
`addr:housenumber=108/110/111-114, Town Hall **Super Market**` [V] — the "Super Market"
block is a real, named part of the complex.

**Not verifiable:** the internal plan of the covered hall, the number of stalls, and
whether a first floor exists over the *fish/vegetable* halls specifically. The 2015
photographs are street-level and cannot see behind the frontage.

### 1.3 Entrances [?]

No entrance is mapped or photographable in the material I could verify. The bazaar
is entered from Asad Avenue through gaps between shop bays [V — visible as dark
openings in 1432/1435] and from Sher Shah Suri Road at the east end [V — the road
name is attached to the adjacent market building]. The mission's brief refers to
"entrances"; I will model two open frontage gaps rather than invent a grand portal.

---

## 2. Kacha Bazaar layout and product sections

### 2.1 The bazaar street [V-source]

The IJSMR paper gives the bazaar street as **500 ft × 25–10 ft, running east–west**.
500 ft = 152 m, which matches the polygon's 134 m long axis to within 12 % — the
polygon is the *site*, the street is the *internal spine*. [V for the dimension,
? for the current width, since 25 ft → 10 ft is a tapering width.]

### 2.2 Sections — positions from OSM [V]

These are real, individually mapped shops inside the block. They are the strongest
evidence available for *where each trade sits*:

| feature | OSM | world (x, z) | from centroid |
|---|---|---|---|
| Town Hall **fish** market (`shop=seafood`) | node 14269781884 | 78.95, 93.73 | 40.8 m |
| Town Hall **vegetable** market (`shop=greengrocer`) | node 14269781888 | 77.19, 85.42 | 49.0 m |
| butcher — *MD Bikram Mangsho Bitan* | node 14269781878 | 68.10, 88.10 | 29.2 m |
| butcher — *Jonopriyo Meat Shop* | node 14269781889 | 79.99, 84.59 | 56.2 m |
| butcher — *Jalabad Meat Shop* | node 14269781891 | 99.13, 91.96 | 96.5 m |
| butcher — *Paradise Broiler House* | node 14269781892 | 99.33, 93.19 | 96.5 m |
| grocery — *Monipur Rice Store* | node 14269781879 | — | 32.0 m |
| seafood — *ACI Harbour* | node 4741836573 | 101.33, 95.76 | 101.3 m |
| *Swapno* super shop | node 4741834976 | 99.78, 86.86 | 101.7 m |

So the trade geography is: **fish and vegetable halls sit at the north-east of the
block, butchers cluster around them and spill east along Asad Avenue**, grocery and
general stores fill the Asad Avenue frontage, and the packaged/electronics end sits
further east. The showcase site analysis adds "grocery, vegetable, meat, fish,
stationery, juice corner, electronics" as the department list [V — as a description of
the *existing* market by a student site survey; the *redesign* that follows it is [P]].

### 2.3 What a kacha bazaar looks like at street level [V]

From the photographs and the showcase site survey: open-air produce selling at the
kerb in **shallow bamboo/wicker baskets**, vegetables heaped in **crates and on
tarpaulin sheets**, **cycle-vans and pickups** unloading, tin-roofed stalls, blue
tarpaulin awnings, and goods stacked to head height. The showcase survey's complaint
about the real market — "insufficient light, ventilation and circulation, unplanned
development … overcrowded" [V] — is itself a description worth reproducing: the kacha
bazaar should feel *tight*, not spacious.

---

## 3. Asad Avenue frontage and road connections

### 3.1 Frontage [V]

The market fronts Asad Avenue on its **north side**, continuous shopfronts for the
full site length, with a service/bus stop node (*Mohammadpur Town Hall Bus stop*,
node 12014830074, at (61.64, 109.26)) standing ~32 m off the centroid. A second
marketplace node (node 12014830571, "Mohammadpur Town Hall Market") sits at
(45.98, 110.76), i.e. at the **west end**, confirming the market reads as one long
strip from the Town Hall junction eastward.

### 3.2 Road connections [V]

- **Asad Avenue** (OSM way 565418929, `highway=secondary`, 2 lanes, oneway,
  maxspeed 40, `sidewalk=left`) — the frontage road.
- **Sher Shah Suri Road** — the market's east/spine road; the adjacent market building
  (way 367594623) is addressed to it.
- **Zakir Hossain Road** and the Town Hall junction — the west end of the site.

### 3.3 A pre-existing geometry offset that constrains everything [V — measured]

The game's Asad Avenue is **not** where OSM puts it. Comparing the real centreline
(21 real vertices) with the game's `asad_4` chord:

| real road vertex | distance to game's chord |
|---|---|
| (66.89, 108.50) | 25.9 m |
| (96.54, 98.17) | 21.2 m |
| (119.64, 96.78) | 35.4 m |

The game's Asad Avenue runs **~21–35 m north** of the real centreline in front of the
market. Consequently the real market polygon, placed at its absolute OSM coordinates,
would straddle the game's carriageway (vertices 5–12 fall on or south of it).

**Decision (see §6):** the road wins — it is out of scope to move it — so the market is
anchored to the **north kerb of the game's Asad Avenue**, keeping the verified plan
shape, area (1.24 ac), orientation and frontage relationship, and inheriting the road's
own pre-existing offset. This is recorded as a known inaccuracy, not hidden.

---

## 4. Mosque and open space — verified positions, and one naming problem

The mission asks for "Shaheed Park Mosque and surrounding open space, with verified
positions". OSM contains **three different features** that the name could mean, and
they are not the same place:

| feature | OSM | tag | position | from centroid |
|---|---|---|---|---|
| **Town Hall Mosque** | node 3030299890 | `amenity=place_of_worship`, `religion=muslim`, `denomination=sunni`, `air_conditioning=yes` | (29.79, 110.02) | 103.1 m |
| **Shahid Park Maszid Market Town Hall** | way 367594623 | `building=yes`, `shop=variety_store` | (32.54, 110.70) | 96.5 m |
| **Shahid Park** | way 304937727 | `leisure=park`, `barrier=wall` | — | 158.5 m |
| Mohammadpur Shahid Park Playground | node 14268507978 | `leisure=playground` | — | 159.9 m |
| Mohammadpur Club Park | way 367594622 | `leisure=park` | — | 116.5 m |

**[V]** The mosque that stands at the Town Hall is tagged simply **"Town Hall Mosque"**;
its **minaret is visible in photograph 1439**, thin and pale, rising behind the
red-brick arcade — that is the best-verified vertical landmark in the whole area.

**[V]** "Shahid Park Maszid Market Town Hall" is a **market building** named after the
mosque, not a place of worship.

**[?]** There is no feature in the extract named "Shaheed Park Mosque". The mission's
name appears to merge the *Shahid Park* (a walled park 158 m away, outside the market
block) with the *mosque* at Town Hall. I will **not** invent a mosque on the park, and
will not move the park: I model the **Town Hall Mosque + its forecourt** at its verified
position, and leave Shahid Park where OSM puts it.

**Open space**: apart from the market's own compound there is no square or park inside
the 1.24-acre site. The showcase *proposal* [P] introduces a "common plaza" — that is a
design idea, not existing fabric, and is not built here.

---

## 5. Shopfronts, signs, stalls, activity — what makes it recognisable

Consolidated from the five usable photographs (all Biswarup Ganguly, 30 May 2015,
CC BY 3.0 + GFDL; no coordinates in the files, so positions are inferred from the
visible street and are [?] individually):

1. **Signboards everywhere, stacked.** Two to three boards per bay, one above the
   other, covering the whole first-floor face: blue/white, red, yellow, green. Book
   boards and poster boards beside doors. This is the single most identifiable trait.
2. **Real shop names are available and should be used.** The project's OSM extract
   gives 163 named POIs within 250 m — *Biskrampur Sweets*, *Shoykat Tehari Ghor*,
   *Darjeeling Momo Station*, *Modina Electronics*, *Liton Master Tailors*, *Cork Sheet
   Box Shop*, *Monipur Rice Store*, *Swapno*, *ACI Harbour*, *Bkash / Grameenphone /
   BanglaLink / Teletalk service points*, and a dense **pharmacy row** on Asad Avenue
   (*Khan Pharma*, *Sami Pharma*, *Leela?/Leed Pharma*, *Rony/Sohel/Milon Medical
   Halls*…). Signage that reuses these names at their mapped positions is authentic by
   construction — nothing has to be invented [V].
3. **Overhead wire tangles.** Poles carry a thick bundle of cables that crosses the
   street diagonally, plus a horizontal run along the kerb. Overcast sky makes them
   read as dark lines across the whole upper frame.
4. **Billboards on poles** — large portrait hoardings above the shop line, two or three
   per block, plus smaller banner boards tied to poles.
5. **Vehicles in the kerb lane**: private cars parked nose-to-tail, white microbus,
   CNG three-wheelers, cycle-rickshaws and battery rickshaws, a pickup with produce.
6. **Produce at the kerb**: shallow baskets of vegetables, squash/pumpkin piled on a
   cycle-van, guava/lemon heaps, vendors sitting on low stools.
7. **Ground detail**: broken kerb and rubble, dark tyre-stained asphalt, a raised
   concrete traffic island with painted lettering, painted pillar bases.

**Recognisability test** — what a person from Mohammadpur would use to identify it:
the long shopfront wall of stacked Bengali signboards under a two/three-storey
terrace, the red-brick arcade block, the pale minaret behind it, the wire tangle, the
kerb produce, and the market crowd. Those are the things the reconstruction must get
right; the individual stalls are less important than the *compression* of them.

---

## 6. Design constraints derived from the existing game world

Measured, not assumed:

| fact | measurement |
|---|---|
| Buildings inside the market polygon | **0** — the site is vacant ground today |
| Nearest existing buildings | 45.0, 48.8, 49.8, 54.8, 60.2, 62.2 m from the centroid |
| Props inside 70 m | 6 |
| Building storey height used by the game | 3.05 m; 2–4 storeys on galis, 3–6 on main roads |
| Kerb assets available | poles, wires, trees, lamps, billboards, apron carts, shutters, sign atlas |

Because nothing stands there, the market can be added **without evicting a single
shipped building** — which is what allows the 845-building baseline to stay intact.

Role of each verified element in the reconstruction:

- market hall + shopfront terrace → the mass along Asad Avenue, north kerb;
- red-brick arcade bay → the one high-detail landmark on the frontage;
- minaret + mosque forecourt → the vertical landmark at the west end;
- bazaar street → internal spine behind the frontage, with fish/veg/meat halls in their
  mapped relative positions;
- kerb kacha bazaar → produce, vans, baskets, tarpaulin on the apron, never on asphalt;
- signage → real shop names from the extract, at their mapped positions where they fall
  on the frontage.

All solids must respect the existing corridor rule (never inside the carriageway),
which the game already enforces through `isClearOfRoads` / `isFootprintClearOfCorridor`.

---

## 7. What remains uncertain

- Interior of the covered hall; number and arrangement of stalls [no source].
- Current (post-2015) facade colours — the only dated photographs are 2015.
- Exact height of the market hall; the 2-storey figure is from a design paper, and the
  photographs show the *adjacent* blocks at 2–3 storeys.
- Whether the bazaar street is still 25 ft at its widest [2015-era dimension].
- Individual photo viewpoints: the 2015 files carry no GPS.

These are reported as **uncertain** in the final comparison rather than smoothed over.

---

## 8. Sources

| # | source | used for |
|---|---|---|
| 1 | Wikimedia Commons, *Asad Avenue* category (14 files, Biswarup Ganguly, 2015-05-30, CC BY 3.0 + GFDL) — files 1432, 1433, 1435, 1436, 1437, 1438, 1439 | facade, signage, arcade, minaret, kerb activity |
| 2 | OSM way **223068917** (`/full.json`) | market polygon, all 12 vertices |
| 3 | OSM way **565418929** (`/full.json`) | real Asad Avenue centreline, lane/sidewalk tags |
| 4 | OSM way **367594623**, node **3030299890** | Shahid Park Maszid Market; Town Hall Mosque |
| 5 | Project extract `data/mohammadpur/mohammadpur.osm.json` | 163 named POIs within 250 m, incl. fish/veg/meat sections |
| 6 | World Bank / FAO, *How clean are the fresh markets?* (P1756630) | Town Hall Market = primary food source opposite the Bihari (Geneva) camp, serves all classes; waste/standing-water problems |
| 7 | IJSMR 06/103 (Town Hall study) | two-storey 1950s supermarket; bazaar street 500 ft × 25–10 ft east–west; 5.5-acre compound figure |
| 8 | showcase.com.bd, *Redesigning of a Civic Bazaar* (AIUB student project, 2019) | **[P]** redesign concept; its site survey supplies the department list and the "overcrowded, poor light/ventilation" description of the *existing* market |

Note on source 7: the PDF would not load on re-check during this session (the host
returned an error); the figures quoted are the ones recorded from the earlier successful
read and are flagged accordingly. Source 8 is explicitly a **proposal** and is used only
for its description of existing conditions.
