# Chan Miya Housing — implementation proposal

**Status: investigation and proposal only. No production code has been changed.**

Investigated 2026-11-07 against `v0.6.7` (`8379f25`) and the relocated OSM dataset
at `data/mohammadpur/mohammadpur.osm.json`.

---

## 1. What actually exists today

The starting assumption — "Chan Miya Housing is missing from the world" — was
**wrong**, and so was an earlier note in `KNOWN_ISSUES.md` claiming zero references
in `src/`. Three real artefacts already exist:

| Artefact | Location | Provenance |
| --- | --- | --- |
| OSM neighbourhood node `13990591896` | `data/mohammadpur/mohammadpur.osm.json`, POI index 2557 | Surveyed OSM node: `চানমিয়া হাউজিং` / `Chanmia Housing`, `place=neighbourhood`, `23.7598997, 90.3580661` |
| Road segment `chanmia_s` — "Chanmia Housing Rd" / "চাঁনমিয়া হাউজিং রোড" | `src/world/mohammadpurData.ts:145` | `source: 'approx_lane'` — **procedural**, explicitly not OSM-verified. `kind: 'gali'`, width 6.4 m, sidewalk 1.8 m, from `bus_stand` to `ring_south` |
| Race waypoint `sc_chanmia_03` — "Chanmia Housing Bypass" / "চাঁনমিয়া হাউজিং বাইপাস" | `src/blacklist/raceRoutes.ts:381-383` | Gameplay route point on the blacklist courses |

### What is genuinely missing

1. **No `PLACES` entry.** `src/world/layout.ts` builds every landmark through
   `makePlaceOnSegment(...)`. There is no `chan mia` / `chanmia` place, so the
   neighbourhood can never be a pickup or drop-off destination, never appears in
   `placeById`, and never shows a named POI toast.
2. **No dedicated geometry.** Nothing in `src/world/city.ts` or `src/world/props.ts`
   renders a distinctive block, gate, sign or plaque for it.
3. **No i18n key.** `src/core/i18n.ts` has 14 `place.*` keys (lines 407-420); none
   covers this location.

So this is a **landmark-surfacing gap**, not missing data and not a regression.

---

## 2. Geographic placement and road connectivity

Using the projection parameters documented in the `mohammadpurData.ts` header
(origin `23.7624 N, 90.3646 E`, compact 0.36× urban scale), the OSM node projects to
approximately:

```
x ≈ -240 m,  z ≈ +100 m      (west of the origin, at the southern side of Ring Road)
```

Nearest existing model geometry:

| Node | Position | Distance | Label |
| --- | --- | ---: | --- |
| `ring_south` | (-204, 96) | ~36 m | Ring Road South |
| `ring_nurjahan` | (-208, 42) | ~66 m | Ring Rd × Nurjahan West |
| `beribadh_w` | (-168, 204) | ~126 m | Beribadh West Approach |

**Two important caveats, stated rather than glossed over:**

- The current modelled extent is **x -218 … 242, z -256 … 248**. The indicative
  position sits at x ≈ -240, i.e. **just outside the western edge**. This must be
  verified before placing anything; it may mean the landmark belongs on the
  `ring_south`/`bus_stand` corridor rather than at the raw node coordinate.
- A defensible least-squares fit of lat/lon → game x/z is **not possible from the
  available anchors**. Only two game nodes carry labels that can be matched to OSM
  POIs (`town_hall`, `ring_tajmahal`), both are junction points rather than POI
  centroids, and the game's node coordinates are visibly hand-tuned. Two noisy
  points do not define a transform. The position above is therefore **indicative,
  with an unquantified error of order tens of metres.**

Connectivity is already solved: `chanmia_s` links `bus_stand` to `ring_south`. Any
landmark placed on that segment is automatically reachable by the existing lane
graph, traffic, missions and races with **no new road required**.

---

## 3. Source confidence

| Question | Answer |
| --- | --- |
| Is the name sourced? | **Yes** — OSM node `13990591896`, `name`, `name:bn`, `name:en` all present. |
| Is it surveyed? | It is an OSM **node** tagged `place=neighbourhood` — a place label, not a building footprint. It is **not** a mapped polygon, so there is no outline, area, height or address to copy. |
| Is the connecting road surveyed? | **No.** `chanmia_s` is `source: 'approx_lane'` — an authored connector. The real street geometry is not claimed. |
| Can we fetch fresh OSM data? | **Not from this environment.** Outbound access is limited to GitHub and package registries; `overpass-api.de` and `openstreetmap.org` are unreachable. Any new query must be run through the existing `import-mohammadpur-map.yml` workflow, which already has network access and provenance tooling. |

**Rule that must hold:** any building added is *procedural infill*, and must be
labelled as such — exactly as `ODBL_NOTICE.md` already requires ("Procedural
buildings and scenery are original game artwork and must not be represented as
source-verified real-world architecture").

---

## 4. Fit with the existing world-generation architecture

The change surface is small and matches established patterns:

1. **`src/world/layout.ts`** — append one line to `PLACES`:
   ```ts
   makePlaceOnSegment('chanmia', 'place.chanmia', 'chanmia_s', 0.45, 1, 'both'),
   ```
   This reuses the existing curb-offset, heading and marker logic. No new maths.
2. **`src/core/i18n.ts`** — add `'place.chanmia'` in Bangla and English. The
   localisation-completeness unit test will enforce that both exist.
3. **Optional geometry** — one frontage block. `city.ts` already places frontages
   through merged `Bucket` geometry with OBB separation checks; a single landmark
   plot should reuse that path rather than adding a bespoke mesh.

No new system, no new dependency, no architectural change.

---

## 5. Visual and gameplay implications

- **Gameplay:** a pickup/drop destination, so it can appear in missions and free
  ride. Low risk, but it changes mission generation output — the seeded-determinism
  tests will need re-running, and any fixture that enumerates places may need
  updating.
- **Races:** `sc_chanmia_03` already routes through the area, so the landmark should
  agree visually with an existing race point rather than contradict it.
- **Visual:** a neighbourhood needs to *read* as housing — repeated mid-rise blocks
  with balconies and shared entry, not a single hero building. At the 0.36× scale
  that is a handful of merged boxes.

---

## 6. Performance cost (estimated, not measured)

- **Landmark place entry:** negligible — `PLACES` is a flat array read for proximity
  checks; adding one element is not measurable.
- **Geometry:** if built through the existing `Bucket` merge path, expect draw calls
  to be **unchanged** (merged into an existing bucket per material family) and
  triangles to rise by roughly a few thousand.
- **No new materials or textures** if existing atlas families are reused.

These are estimates. Nothing here has been profiled, and the project's own standard
applies: no FPS claim without a real measurement.

---

## 7. Recommended implementation order

| Step | Change | Risk |
| --- | --- | --- |
| 1 | Add `place.chanmia` to `i18n.ts` (bn + en) | none |
| 2 | Add the `PLACES` entry on `chanmia_s` | low — one line |
| 3 | Re-run unit tests, especially mission determinism and localisation completeness | none |
| 4 | Only if visually unsatisfying: add merged frontage geometry via the existing bucket path | medium — must not break OBB separation |
| 5 | Regenerate the minimap if a new road or POI is added | low |

Recommended stopping point for the first pass: **steps 1-3.** That delivers a real,
named, sourced landmark destination with effectively zero risk to the world.

---

## 8. Open questions for the owner

1. Should the landmark sit on the existing `chanmia_s` connector (safe, no new road),
   or should the western extent be verified first given the indicative position lies
   just outside it?
2. Is a named destination enough for this pass, or is distinctive housing geometry
   required at the same time?
3. Should the `chanmia_s` connector be re-imported from OSM to upgrade it from
   `approx_lane` to surveyed geometry? That changes the map's provenance claims and
   should be a separate, explicit decision.
