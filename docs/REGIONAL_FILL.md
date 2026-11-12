# Regional fill system

Deterministic fill budgets for areas the shipped world never mapped, plus the two
verification gaps that blocked them (a corridor index that could not see a newly
added road, and an interior ordinal whose mutation was undetectable).

Start checkpoint: `9f3e26e` (interior/infill isolation complete).
Shipped world unchanged throughout: **845 buildings, digest `c60e15b5`**.

---

## 1. The hole being closed

`legacyFillLayout.ts` pins the shipped world by freezing an ordinal per candidate:
a building's size and style are properties of *its position*, not of how many
candidates were visited before it. That removed all topology coupling for the 70
shipped roads — and left one documented hole:

> A candidate with no frozen ordinal is skipped.

So a road added to a region the shipped world never covered received main-pass
street frontage and nothing else: no block-interior fill, no infill seams. The
city generator could only fill Mohammadpur.

The regional fill system gives those candidates a budget that is **local** (one
spatial region), **deterministic** (a pure function of the region's identity) and
**isolated** (no counter another region can shift).

---

## 2. Region identity, and why 48 units

A region is a square cell of `REGION_SIZE = 48` world units:

```
regionKeyOf(x, z) = `${floor(x / 48)},${floor(z / 48)}`
```

The key is a pure function of position. It does not depend on array order, on how
many regions were visited, on the process, or on the machine; `Math.floor` (not
truncation) keeps negative coordinates in their own cells.

Cell size was **measured, not chosen**. The shipped world's 160 frozen interior
candidates were binned at three candidate sizes:

| cell | occupied regions | min | median | p75 | max |
| ---- | ---------------- | --- | ------ | --- | --- |
| 36   | 67               | 1   | 2      | 3   | 8   |
| **48** | **53**         | **1** | **3**  | **4** | **10** |
| 96   | 26               | 1   | 4      | 5   | 14  |

36 fragments the city into 67 mostly-single-building cells (a "region" smaller
than a block); 96 pools whole neighbourhoods into a lumpy 1–14 band. 48 is the
only size whose typical region reads as one block *and* whose densest shipped
region (10) is above the budget ceiling, so no new area can out-densify the
densest one that ships today.

## 3. Budget: a range, derived from the same measurement

```
regionBudget(key) = 4 + (hashString(key) mod 5)      // 4..8 inclusive
```

- **4** is the legacy p75 — a newly mapped block reaches ordinary shipped density.
- **8** stays below the legacy maximum of 10 — new areas cannot out-densify the
  shipped world.
- Varying it by key avoids a uniform stamp while staying a pure function: no
  counter, no draw from a shared stream, no dependence on visit order.

`derivedFillOrdinal(x, z)` plays the same role for new candidates that the frozen
table plays for shipped ones: `hashString` of the 1 cm-quantised position, modulo
1000. A sub-centimetre float wobble cannot restyle a building, and no other
region's existence can shift it.

Spend is tracked by `RegionBudgetLedger`, created once per `buildCity()` call —
never module state, so every build starts empty.

## 4. Gap B — the corridor index could not see a new road

### The defect

`layout.ts` built its 28 × 28 spatial hash (cell 24, grid −312…+360) **once, at
module load**. Anything pushed into `ROAD_SEGMENTS` afterwards was invisible to
`distanceToRoadCarriageway`, `distanceToRoadCorridor` and
`isFootprintClearOfCorridor` for the rest of the process.

Every earlier perturbation test that injected a road therefore measured the wrong
thing: placements could land on the new carriageway, and "0 buildings removed"
described parcel/overlap coupling only.

### Fix

`rebuildRoadSpatialIndex()` clears every bucket and refills it from the live
`ROAD_SEGMENTS` and `GRAPH_NODES`; it runs at module load (so production behaviour
is byte-identical) and is idempotent. `roadSpatialIndexStats()` and
`roadSpatialIndexHasSegmentAt(x, z, id)` exist so tests can assert on the real
index rather than on a re-implementation.

### Evidence at a probe point

Road `synth_corridor` = (−60, −200) → (60, 160); probe 20 % along it at (−36, −128):

| | `hasSegmentAt` | carriageway distance | 7 × 7 footprint verdict |
| --- | --- | --- | --- |
| stale index (module-load only) | `false` | +17.81 m | **clear** (would allow placement on the road) |
| after `rebuildRoadSpatialIndex()` | `true` | −4.50 m | blocked |

Index stats: 784 cells, 1 243 segment entries, 221 node entries, 70 distinct
segments; after adding one road 1 379 / 71.

### What the corrected index then revealed

With the index honest, a road driven through the mapped blocks removes shipped
buildings. This is **pre-existing**, not introduced here: run against `9f3e26e`'s
generator with a rebuilt index, the same perturbation evicts **the same 54
buildings** (set equality verified, not just the count). With the stale index the
same build reported **0**.

That is the building-versus-carriageway precedence policy, which this mission was
explicitly told not to decide. It stays open (§7); what changed is that the test
suite can no longer be fooled into thinking nothing happens.

### Corridor enforcement now

- 0 of 824 footprinted building colliders in the shipped world overlap a
  carriageway (`isFootprintClearOfCorridor`, 0.55 m setback).
- 3 building colliders carry no `yaw` (authored 8 m market/apron structures,
  axis-aligned). They are tested by sampling their box on a 9 × 9 grid instead of
  being skipped; minimum carriageway distance is 2.48 / 3.06 / 3.59 m.
- With a road through the city: 0 violations, every building in the new road's
  frontage band is > 6 m from its centreline, and the three yaw-less structures
  remain clear.

## 5. Gap A — the interior ordinal mutation was undetectable

### The gap

`interiorCount` equals the frozen ordinal for all 160 shipped interior buildings,
so replacing the frozen lookup with a running counter still produced 845
buildings and `c60e15b5`. No test could tell the two implementations apart.

### Closing it

`tests/unit/interior-ordinal-stability.test.ts` applies a **controlled candidate
insertion** to the real frozen table (the shipped visit sequence, ordinals
0…159) and computes both assignments side by side:

| insertion | frozen ordinals changed | counter ordinals changed |
| --- | --- | --- |
| 25 candidates before the legacy run | 0 | 160 (all +25) |
| 25 in the middle | 0 | 80 |
| 25 after the legacy run | 0 | 0 |
| reversed / rotated list | 0 | > 100 |

Past the pass's 160-candidate cap the counter model also **drops 25 legacy
buildings outright** (135 of 160 survive), because foreign candidates occupy the
ordinals the shipped run needs.

At system level the same file asserts that a new region's fill leaves all 845
footprints and all 160 interior dimensions intact.

### Honest limit

The *unit* demonstration is discriminating on real data; the *world-level* test
is not on its own, because the legacy-first phase split already prevents a new
region's candidates from interleaving with legacy ones. The mutation that does
get caught at world level is the counter for the shipped interior ordinal
(§6, mutant B).

## 6. Mutation matrix

Each mutant was applied to the final code, the named suites were run, and the
file was restored (`md5sum` verified identical after every run).

| # | mutation | result | caught by |
| --- | --- | --- | --- |
| A | legacy-first phase split removed (interleave by `order`) | **survives** | — (see §7.1) |
| B | shipped interior ordinal ← running `interiorCount` | killed | `fill-isolation`: 104 evictions vs 54, 49 interiors resized |
| C | new-region ordinal ← order-dependent counter | killed | `regional-fill` ×3: 62 buildings near road A restyled; additivity 277 vs 279 |
| D | interior region budget removed | killed | `regional-fill` ×2: region −20,−2 spends 7 with a budget of 4 |
| E | extension grid as first written (legacy-box-seeded bounds, no new-road gate) | killed | `regional-fill` ×2: a candidate 512.5 m from the road; additivity 326 vs 338 |
| F | region fill no longer scoped to unmapped areas | killed | `corridor` + `fill-isolation`: 59 evictions vs the 54 baseline |

Mutant E is how the extension grid was actually written first. Seeding the max
accumulator with `-LEGACY_BOX` (−224) instead of −∞ clipped it there, so a road
700 m west dragged the fill grid back to the shipped edge: **154 additions with no
new road within 43 m**. The grid is now seeded from the segments themselves and
every candidate must also be within 43 m of a *new* segment.

## 7. Legacy precedence, and what is still open

### 7.1 Rules that keep the shipped world exact

1. **Region fill comes only from new segments**, and only outside the shipped
   extent (±224, the block-interior grid's box).
2. **An unfrozen candidate along a shipped road stays empty.** The shipped world
   left that lot unbuilt (sector budget, count cap, or a rejected overlap), so it
   is not a new region's to take.
3. **The legacy phase runs to completion first** in the block-interior pass.
4. Budgets are per region and per build; no counter is shared with the legacy
   passes.

Rule 2 is the one that had to be discovered by measurement. With only rule 1,
region fill cost **5** extra shipped buildings on a road through the city (59
instead of 54); restricting pass A/B to new segments brought it to **57**; adding
rule 2 brought it to **54 — set-identical to `9f3e26e`**.

With no new segments, none of this code runs: `c60e15b5` is unchanged and the
build cost is not measurably different (median 3 070.7 ms vs 3 028.4 ms for
`9f3e26e`, inside a 2 750–3 663 ms run-to-run spread).

### 7.2 Still open

- **Building-versus-carriageway precedence.** A road through mapped blocks evicts
  54 shipped buildings at both `9f3e26e` and now; 40 % of them are not
  footprint-overlapping (the new road becomes their nearest road, so their yaw
  changes and they fail collision). This is the unresolved product decision from
  `ARENA_CONTINUATION.md` §8. Nothing here decides it, and no production road is
  added.
- **Mutant A survives.** With rules 1–3 in place, a region candidate cannot
  interleave with a legacy one in a way these tests can observe. The split is
  retained as defence in depth (the boundary case — a fill parcel just outside
  ±224 at the same moment a legacy candidate is resolved — is ~7 m of potential
  overlap), but it is currently unfalsifiable and should not be described as
  tested.
- **Visuals were not re-shot.** The shipped world is byte-identical
  (`c60e15b5`), so there is no new before/after to compare. Rendering is
  untouched; the visual gate is **not applicable** rather than passed.
- **New-region aesthetics are unvalidated in the browser.** Region fill has been
  checked numerically (counts, budgets, corridor clearance), not looked at. A
  synthetic road's neighbourhood has never been rendered.

## 8. Preservation evidence

| gate | result |
| --- | --- |
| buildings / digest | **845 / `c60e15b5`** (`world-baseline` 15/15) |
| lanes | 140 / `52306cb0` (`lane-graph-baseline`) |
| gameplay baseline | `gameplay-baseline` passes |
| Vitest | **656 passed / 63 files** (was 607 / 60) |
| Python map-import | **34 passed** |
| production build | **370.16 kB gzip** (was 369.27 kB) |
| `tsc --noEmit` | clean |
| `git diff --check` | clean |
| cross-process determinism | two separate Node processes: base `845 / c60e15b5`, with far road `989 / 60c6d1e6` — identical |
| repeat build in process | identical `buildings` array |

**One flake, recorded rather than hidden.** One full-suite run during this work
reported 654/656 (2 tests in 1 file). Its log was truncated by a `tail`, so the
test names were lost, and it did not reproduce: five subsequent full runs are
656/656. The suite runs 63 files under Vitest's default 5 s per-test timeout, and
the three new suites add ~50 s of CPU-heavy work in parallel — a plausible
load-related timeout in an unrelated file. Nothing was skipped, relaxed or
re-run "until green" without saying so; if it recurs, capture
`--reporter=verbose` to a file before investigating.

## 9. Next best step

Decide §7.2's precedence rule, because it is now the only thing standing between
the regional fill system and a real production road: everything else about a new
region is bounded, deterministic and corridor-safe. Before that decision, the
cheapest useful increment is a **rendered** check of a synthetic road's
neighbourhood — the numbers are right, but nobody has looked at the result.
