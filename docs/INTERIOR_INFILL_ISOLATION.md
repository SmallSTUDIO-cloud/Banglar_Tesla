# Interior & Infill Generation Isolation

**Status:** implemented, tested, mutation-checked, committed on
`arena/f78d620e-banglar-tesla`.
**Scope:** procedural building generation only. No road, lane, node, POI, boundary,
gameplay or UI data changed. Mirpur Road was **not** integrated.

---

## 1. The problem, reproduced

`buildCity()` generated buildings in six places. Two of them — the block-interior
pass and the infill / shop-front passes — read **mutable global counters** and
**iteration order** as generation inputs. A fourth, the main apartment pass, read
`ROAD_SEGMENTS` array order.

Measured on the shipped world (845 buildings, digest `c60e15b5`) by injecting real
segments into the live array inside a throwaway harness:

| Perturbation | Before isolation | After isolation |
|---|---:|---:|
| Reverse `ROAD_SEGMENTS` (same 70 ids, same geometry) | **674 replaced** | **0** |
| Add one test road through the city | **162 replaced** | **0** |
| Add one test road 5 km away | 0 replaced | 0 |

The reorder result is the headline: **no road was added, moved or removed**, yet
674 of 845 buildings changed. That is pure order dependence.

Breakdown of the 674 (genuine per-pass provenance, not nearest-road attribution):

| Pass | Replaced |
|---|---:|
| main apartment | 447 |
| block interior | 112 |
| infill strip | 58 |
| shop-front fill | 57 |

---

## 2. Root cause

| Pass | Source order | Dimension input | Why topology changes it |
|---|---|---|---|
| main apartment | `ROAD_SEGMENTS` | per-segment RNG (already pinned) | placement depends on the shared parcel grid → first-come wins |
| infill strip | `ROAD_SEGMENTS` | `infillCount` (mutable) | budget cap 112 + per-sector cap 8 is consumed in iteration order |
| block interior | fixed 11.8-unit world grid | `interiorCount` (mutable) | candidates sorted city-wide by `-gap + tie`, where `gap` = distance to **every** placed building; cap 160 |
| shop-front fill | `ROAD_SEGMENTS` | `infillCount` (shared with infill) | same counter, so infill changes renumber shop-fronts |

Two independent mechanisms:

1. **Order dependence.** Array order decided who claimed a parcel first, and in
   what order a shared counter was spent.
2. **Global quota.** `interiorCount` and `infillCount` were read *and written* by
   every candidate in the city, so losing one candidate anywhere renumbered every
   later candidate everywhere — changing width, depth, floor count, tint and stall
   variant.

A fifth mechanism surfaced during testing and is worth recording: **a new road's
own buildings could evict legacy ones.** The shared parcel grid gave first-come
priority to whoever ran first, so a road added later had its frontage suppressed by
existing buildings (and, once ordering changed, vice versa: 5 legacy interior
buildings were evicted by the new road's own buildings).

---

## 3. The design

Three changes, each independently testable.

### 3.1 Canonical generation order — `src/world/legacyFillLayout.ts`

`canonicalSegments(segments)` returns legacy segments in a **frozen** order
(`LEGACY_SEGMENT_ORDER`, the 70 ids exactly as the shipped world was built),
followed by every non-legacy segment sorted by id.

It is a pure function of the **set** of ids, so array order stops being an input.
Legacy always comes first, so a new road can never take a parcel a legacy road
would have claimed in the shipped world.

Used by all four segment-driven passes.

### 3.2 Frozen ordinals — same module

Each shipped fill candidate's ordinal is stored, keyed by its own coordinates at
2 dp:

```ts
LEGACY_INFILL_ORDINALS   // 118 entries, 0..117 (infill strip + shop-front fill)
LEGACY_INTERIOR_ORDINALS // 160 entries, 0..159
```

The pass looks its ordinal up by position instead of reading a running counter.
Ordinal values equal what the old counters produced, so the shipped world is
bit-identical; but losing a candidate elsewhere can no longer renumber it.

A candidate with no frozen ordinal is **skipped**, not numbered from a shared
counter. This is a deliberate trade-off, see §7.

### 3.3 Legacy precedence in the parcel contest — `canPlaceBuilding(..., legacyPrecedence)`

Footprints are tagged `legacy: true` when contributed by a legacy segment. With
`legacyPrecedence` set, a legacy candidate ignores non-legacy footprints in the
parcel grid.

**Corridor checks are untouched.** A legacy building is still refused if a road
carriageway covers it. Only the building-vs-building contest is weighted, and only
in favour of what already existed. Without this, "adding a road changes nothing"
would have been achieved by letting the new road silently delete existing
buildings — a world change dressed up as locality.

### 3.4 Interior road scope — `snapToNearestRoad(x, z, allowGali, scope)`

Block-interior buildings were oriented to `snapToNearestRoad(x, z)`. A road added
later could become the new nearest centreline and rotate an existing building.
The interior pass now passes an explicit legacy-only scope. The default remains
every segment, so gameplay ("which road am I on?") is unchanged.

Interior ordering also reads `legacyPlacedBuildings`, a snapshot restricted to
legacy contributions, instead of the full list.

### 3.5 Rejected alternatives

| Option | Why rejected |
|---|---|
| Per-region interior budgets (spatial cells) | Would change the shipped allocation unless the exact legacy allocation were reproduced per region — more moving parts for the same result, and region seams introduce a new class of bug. |
| Hash-seeded local streams for fill | Changes current output (ordinals feed dimensions); would regenerate the world. |
| Freezing the whole interior candidate list as data | Ends procedural generation; a road at a new location could never get interior fill. |
| Do nothing (accept drift) | Violates the milestone gate. |

---

## 4. Verification

### 4.1 World preservation

| Check | Result |
|---|---|
| Building count | **845** (unchanged) |
| World digest | **`c60e15b5`** (unchanged) |
| `tests/unit/world-baseline.test.ts` | 15/15 pass, no drift |
| Gameplay baseline | unchanged |
| Lane baseline (140 lanes, `nextlaneIds`) | unchanged |
| Primary + downstream RNG | `building-rng.test.ts` unchanged and passing |

### 4.2 Locality

| Test | Before | After |
|---|---:|---:|
| Reverse segment array | 674 replaced | **0** |
| Arbitrary reordering (by reversed id) | — | **0** |
| Road added 5 km away | 0 | **0** (28 new, all at x > 4000) |
| Road added through the city | 162 replaced | **0 removed**, +5 new |
| Repeat builds in one process | — | identical digest |
| Duplicate ids after topology change | — | none |

**A note on how "replaced" is measured.** The world snapshot's `id` is
`<nearest segment>:<x>,<z>`, produced by `nearestSegmentId`. It is
**nearest-road attribution, not generation provenance**. Adding a road
legitimately changes which road some buildings are nearest to, with no change to
the buildings. Comparing ids reported **39 phantom removals** for a road that moved
nothing — measured, then corrected. The tests therefore compare building
**geometry** (position, width, depth, height as an order-independent multiset), and
separately assert the raw collider rectangles are untouched. This is the same class
of error the previous session's `buildingsBySegment` attempt hit; it is now
documented and encoded in the test helper.

### 4.3 Mutation proof

Each mutation was applied, the tests run, then the file restored from a saved copy.

| Mutation | Result |
|---|---|
| Revert canonical order to `ROAD_SEGMENTS` array order | **2 tests fail** (reorder + arbitrary reorder) ✅ |
| Corrupt one frozen interior ordinal (0 → 1) | **1 test fails** (ordinal contiguity) ✅ |
| Revert interior `width`/`depth` to the global `interiorCount` | **tests pass** ⚠️ see §7 |

### 4.4 Gates

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Full suite | `npx vitest run` | **607 passed / 60 files** |
| Python | `python3 -m unittest discover -s tests/map_import` | **34 OK** |
| Build | `npm run build` | exit 0, **369.27 kB gzip** |
| Road audit | `npm run audit:roads` | unchanged (no road data touched) |
| Scope audit | `npm run audit:scope` | unchanged |

Build size rose 366.20 → 369.27 kB gzip (+3.07 kB, +0.84 %). The new module adds
~460 lines of frozen tables. Not free; accepted as the cost of shipping data
identical world.

### 4.5 Visual verification — performed

Genuine headless-Chromium screenshots of the built game from **both** this branch
and the previous commit `b57dd33`, same fixed viewpoints, same seed (seed is a
constant in source), 960×540.

| View | Differing pixels |
|---|---|
| `density-town` | 7,172 (1.383 %) |
| `density-south` | 6,475 (1.249 %) |
| `market-townhall-street` | 606 (0.117 %) |

Every differing region was inspected on a difference mask: **pedestrians, moving
vehicles, foliage sway, and a distant traffic light**. No facade, roofline,
window, balcony, shopfront, sidewalk, road surface, or market stall is flagged in
any view. Buildings are unchanged, as the digest already implied.

### 4.6 Performance — measured, no regression detected

`buildCity()` wall time, 5 runs each, first discarded as warm-up, same machine:

| Run | This branch (mean) | `b57dd33` (mean) |
|---|---:|---:|
| 1 | 3,405.5 ms | 3,193.7 ms |
| 2 | 3,530.1 ms | 3,558.4 ms |

The two runs disagree in sign, and run-to-run variance is ~10 % — larger than any
difference between branches. **Conclusion: no measurable change.** No optimisation
was attempted, and none is warranted on this evidence. Frame rate, draw calls and
memory were not measured; nothing in this milestone changes them.

---

## 5. Files changed

| File | Change |
|---|---|
| `src/world/legacyFillLayout.ts` | **new** — frozen segment order + 278 ordinals + `canonicalSegments` |
| `src/world/city.ts` | canonical order in 4 passes; frozen ordinals; legacy precedence; interior road scope; `legacyPlacedBuildings` |
| `src/world/layout.ts` | `snapToNearestRoad` gains an optional explicit segment scope (default unchanged) |
| `tests/unit/fill-isolation.test.ts` | **new** — 19 tests |

No baseline file was modified.

---

## 6. How to regenerate the tables

**Do not regenerate them to make a test pass.** They describe the city that ships.

The capture procedure, if the world is ever deliberately redesigned: temporarily
tag each building push site with its pass and, for fill candidates, the running
counter value; run one build; dump `pass -> {"x,z": ordinal}`; write the tables.
Ordinals must be contiguous from 0 within each table, which
`tests/unit/fill-isolation.test.ts` asserts.

---

## 7. Known limitations and honest gaps

1. **The frozen ordinals are currently belt-and-braces, not load-bearing.** The
   mutation that reverted interior dimensions to `interiorCount` did **not** fail
   any test. Reason: the interior pass has a fixed candidate universe with no
   RNG, so for the shipped graph `interiorCount` is always equal to the frozen
   ordinal. The ordinals only diverge when a candidate is *added* to the universe
   — and no test adds one, because the grid is fixed. So the failure mode the
   ordinals defend against is real but currently untriggerable. This is stated
   rather than papered over: the mutation matrix shows one green mutation.

2. **The corridor spatial index is built once, at module load.** `spatialCells` in
   `layout.ts` is populated from `ROAD_SEGMENTS` at import time, so a segment
   pushed onto the array afterwards is invisible to `distanceToRoadCorridor` and
   `isFootprintClearOfCorridor`. This **helped** the tests above (they exercise
   parcel coupling only) and it is also why they cannot exercise corridor
   coupling. In production, roads are added in source, so the index always sees
   them. If roads ever become dynamic, the index must be rebuilt. Not changed here
   — it is a pre-existing property, out of scope.

3. **A non-legacy fill candidate is skipped, not generated.** Because ordinals
   are looked up rather than counted, a new-region candidate with no frozen
   ordinal produces no infill/interior building. New areas get main-pass frontage
   only until a deliberate follow-up gives them independent local budgets. This is
   the conservative choice: the alternative is a shared counter, which is exactly
   the coupling being removed.

4. **Unresolved product decision, unchanged:** what to do when a *road carriageway*
   covers an existing building. This milestone preserves the building and does not
   resolve the conflict — see
   [`MIRPUR_INTEGRATION_ATTEMPT_2.md`](./MIRPUR_INTEGRATION_ATTEMPT_2.md) §9.2 for
   the three options. No policy was chosen.

---

## 8. Next recommended action

Give new regions their own independent fill budgets and deterministic streams
(the §3.5 per-region design), so a road added to an unmapped area gets interior
fill without any shared counter. Then the Mirpur corridor decision in
`MIRPUR_INTEGRATION_ATTEMPT_2.md` §9.2 is the next thing that needs a human.
