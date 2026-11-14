# Phase 1 — Asad Avenue + Town Hall Bazar: implementation plan

Scope, exact files, risks, and what has actually been done versus what is still planned.

Status key: **[DONE]** implemented and tested · **[PLANNED]** not started · **[BLOCKED]** needs
something this environment cannot provide.

---

## 0. What is already delivered (this commit)

| Item | Status |
|---|---|
| Research document with sources and explicit unknowns | **[DONE]** `docs/MOHAMMADPUR_RESEARCH.md` |
| Verified POI registry (15 records, machine-generated) | **[DONE]** `src/world/poiRegistry.ts` |
| Provenance gates (20 TS + 21 Python assertions) | **[DONE]** |
| Route computation over the live gameplay graph | **[DONE]** `src/world/mapRouting.ts` + 9 tests |
| Full-screen pannable/zoomable map, markers, NOT CONNECTED YET, route line | **[DONE]** `src/ui/mapScreen.ts` |
| HUD map button + destination chip with live distance + cancel | **[DONE]** |
| Phase 1 *geometry* rebuild | **[PLANNED]** — see §2, blocked on a design decision |

Verified in a browser: map opens, tap selects a POI, SET DESTINATION draws a route over real
segments, HUD shows `টাউন হল বাস স্টপ · 284 m`, and the chip survives closing the map.
Screenshots: `artifacts/map-screen.png`, `map-selected.png`, `map-route.png`,
`map-hud-destination.png`.

---

## 1. The awkward truth this phase must confront

The task says *"Build actual road geometry into the gameplay graph."* That is the correct
goal, and it is the expensive one. `RoadSegment` is a **straight chord**: `ax/az → bx/bz`
with a single `ux/uz` tangent, `leftX/leftZ` normal, and scalar `center/fromCoord/toCoord`
summary fields. There are **321 references across 14 files** (traffic, police, pedestrians,
routes, races, props, road damage, market apron, corridor identity).

Converting to real polylines means either:

1. **Densify** — replace each chord with a *chain of short chords*, keeping every
   `RoadSegment` straight. No consumer changes: traffic still drives straight segments, the
   graph just has more of them. Real curvature appears; junction topology stays keyed to the
   existing 42 node ids.
2. **Refactor to polylines** — true curved segments with arc-length projection. Truest
   geometry, but it rewrites 321 call sites and invalidates race blueprints, mission
   anchors and traffic tuning.

**Recommendation: (1) densify.** It is reversible, keeps the whole test suite meaningful, and
gets the recognisable outcome (streets that bend where this one bends) without a rewrite.

### The experiment I ran, and its honest result

I implemented the smallest possible slice of (1): snapping Asad Avenue's seven existing
nodes onto the real centreline of **OSM way 565418929** (a 21-vertex polyline). Displacement
11.5–16.5 m per node.

`npm test` → **4 failures**, all traced to authored coordinates that encode the old geometry:

| Failing test | Why |
|---|---|
| `landmarks.test.ts` → *bazaar marker anchored within 15 m* | Town Hall marker now 20.8 m from the bazaar place marker |
| `traffic-advanced.test.ts` → *left/right connector without jumps* | scripted path keyed to old node positions |
| `v05-v4-race-map.test.ts` → *17 race blueprints* | a shortcut now saves **0 m** (234 vs 234) |
| `vnext-race-timing.test.ts` → *AI finisher breathing room* | lap timing recalibrated by longer segments |

**I reverted it.** Re-pointing authored content (race shortcuts, scripted traffic, place
markers) is a design decision about gameplay content, not a coordinate fix, and doing it in
the last moments of one session — with a shortcut that silently stops being a shortcut —
is exactly the kind of "fake progress" the brief forbids. The full suite is green (396/396)
with the revert in place.

---

## 2. Phase 1 plan (next session)

### Step 1 — Densify Asad Avenue **[PLANNED]**
- **Files:** `src/world/mohammadpurData.ts` (new sub-nodes), `src/world/layout.ts`
  (no structural change), `src/world/poiRegistry.ts` (unchanged).
- **Method:** insert OSM way 565418929's intermediate vertices as gali-class sub-segments
  between existing ids, so `asad_1…asad_6` become chains. Keep the original 42 node ids and
  all segment ids as the *spine*; add `asad_3a`, `asad_3b`, … for the bend points.
- **Risk:** segment count grows (each added vertex is one extra `RoadSegment`), which
  touches `buildChunked` sector bucketing and prop snapping. Must re-measure draw calls.
- **Verification:** `npm run typecheck`, `npm test`, `npm run test:geography`,
  browser screenshots from the same camera as `artifacts/asad-avenue-current.png`.

### Step 2 — Re-anchor authored content **[PLANNED]**
- **Files:** `src/blacklist/raceRoutes.ts` (17 blueprints), `src/world/layout.ts` `PLACES`,
  `tests/unit/traffic-advanced.test.ts` scripted path.
- This is the step that broke above. It must be done deliberately, with each race
  re-verified for grid clearance and shortcut benefit, and the test updated to the new
  *authored* truth rather than to whatever the code happens to output.

### Step 3 — Town Hall Bazar block **[PLANNED]**
- **Files:** `src/world/corridorIdentity.ts` (structure planning), `src/world/city.ts`
  (reserve parcels before infill, via `addFootprint` — see `docs/GEOGRAPHIC_ACCURACY.md` §11).
- **Form (sourced):** long **2-storey** market block + a longer **open-air bazaar street**
  running east–west, ~500 ft long, 10–25 ft wide, stalls for vegetables/fish/meat/grocery,
  mosque opposite. Not a tall building.
- **Risk:** the frontage is already saturated with generated buildings (a previous attempt to
  add structures after infill placed **zero**). Parcels must be reserved first.
- **UNVERIFIED:** fascia colours, sign fonts, stall canopy colour. Any such choice is a
  stylistic decision and must be labelled as one in the commit message, not presented as
  observed fact.

### Step 4 — Street-level life **[PLANNED]**
- Reuse the existing `marketApron` vendor-cart system and `storefronts` board atlas; add
  vegetable vans and fruit carts where the research supports them, using real shop names
  only where an OSM `name` exists (see the v0.7.0 storefront rule).

---

## 3. Risks carried forward

| Risk | Mitigation |
|---|---|
| Densification inflates draw calls / triangles | Re-run `tests/e2e/bench-street.mjs` after each step; compare to the baseline in `docs/GRAPHICS_BASELINE.md` |
| Race/mission content silently degrades (as happened above) | Re-verify shortcut distances and AI timing explicitly, not just "tests pass" |
| Structures overlap existing buildings | Reserve parcels via `addFootprint` **before** infill, then assert with `npm run test:geography` |
| Autotile/prop placement assumes straight long segments | Check `props.ts` and `city.ts` clearance after densification |
| Non-ASCII renaming of ids | Never rename existing ids — missions, races, pickups and saves reference them |

## 4. Explicitly out of scope this phase

Other districts (Krishi, Ring Road, Geneva, DRMC, Saat Gumbad, Tajmahal) stay **map-only**:
listed, categorised, navigable, and marked NOT CONNECTED YET where the graph does not reach
them. Tokyo Square and Japan Garden City are outside the playable extent and must never be
built in 3D.

## 5. Not verified / not claimed

- **No Android device test.** Frame times in this environment are SwiftShader software
  rasterisation and say nothing about a phone. See `docs/GRAPHICS_BASELINE.md` §4.
- **No photograph was inspected.** See `docs/MOHAMMADPUR_RESEARCH.md` header.
- **No new 3D building geometry** exists yet — Phase 1 §2 steps 3–4 are unimplemented.
