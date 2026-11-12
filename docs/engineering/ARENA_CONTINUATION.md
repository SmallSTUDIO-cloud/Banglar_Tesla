# Arena Continuation Checkpoint

**This file is the resume point.** Read it first, verify the recorded commit against the
remote, then continue from §7.

---

## 1. Identity

| Field | Value |
|---|---|
| Branch | `arena/f78d620e-banglar-tesla` |
| Base commit | `2dc02d7` (branch point, per Arena) |
| **Checkpoint commit** | **`583654c`** |
| Remote (verified via `git ls-remote`) | `arena/f78d620e-banglar-tesla` = `583654c` |
| Production `main` | `84e79e4` — **untouched, never merged, never pushed** |
| Push method | fast-forward only, verified after every push |

## 2. Session log (real timestamps, UTC)

| Session | Start | End | Commits produced |
|---|---|---|---|
| 2026-11-12 (earlier) | ~04:03 | ~04:20 | `f134e41`, `2e4d3a2`, `316ccf8`, `b57dd33` |
| 2026-11-12 (this one) | ~05:31 | ~06:00 | `583654c` |

Cumulative campaign time is **well under two hours**, not the eight-hour target. No claim
of longer runtime is made.

## 3. Campaign commits (oldest first)

| Commit | What |
|---|---|
| `f134e41` | Isolate building RNG: per-segment pinned legacy streams + pinned litter stream |
| `2e4d3a2` | Boundary-clipped map scope audit; coverage 32.3 % → 16.4 %; Mirpur 1,704 m |
| `316ccf8` | Mirpur attempt 2 measured and reverted; two structural couplings documented |
| `b57dd33` | This checkpoint file created |
| **`583654c`** | **Interior/infill generation isolation; zero-drift world preserved** |

## 4. Verified state at this checkpoint

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Unit/integration | `npx vitest run` | **607 passed / 60 files** |
| Python (OSM import) | `python3 -m unittest discover -s tests/map_import` | **34 OK** |
| Production build | `npm run build` | exit 0, **369.27 kB gzip** |
| World baseline | `tests/unit/world-baseline.test.ts` | **845 / `c60e15b5`, no drift** |
| Fill isolation | `tests/unit/fill-isolation.test.ts` | **19 passed** |
| Lane baseline | `tests/unit/lane-graph-baseline.test.ts` | **140 lanes / `52306cb0`** |
| Scope audit | `npm run audit:scope` | 3.541 km² ring, 16.4 % (unchanged) |

**Measured locality now:** reversing `ROAD_SEGMENTS` → 0 buildings changed (was 674).
Adding a test road through the city → 0 legacy buildings removed (was 162).

## 5. Workspace state

- Working tree clean except three **user-owned untracked** paths that must never be deleted
  or committed blindly:
  - `docs/ASAD_AVENUE_ARCHITECTURE_REVIEW.md`
  - `docs/PHASE1_POLYLINE_ROAD_DESIGN.md`
  - `image-search/`
- `node_modules/` is **not persisted** across sandbox restores. Run `npm ci` first.
- No worktrees left behind (`git worktree list` shows only the main tree).

## 6. Known environment hazard (recurring, every session so far)

**Every fresh sandbox has shown an empty git index and a HEAD reset to the branch base
(`2dc02d7`).** This makes the entire repository look modified (231 paths this time). It is
not — the remote is authoritative.

Recovery, non-destructive, in this order:

```bash
git fetch origin arena/f78d620e-banglar-tesla
git read-tree <verified-tip-sha>
git update-ref refs/heads/arena/f78d620e-banglar-tesla <verified-tip-sha>
git status --short          # expect only the three untracked paths in §5
```

Verify `/dev/null` exists (`crw-rw-rw- 1 root root 1, 3`) before long command sequences.
Never use `git reset --hard`, `git checkout -- .`, `git clean`, or `git restore .`.

## 6a. Regional fill system — DONE (this milestone)

Committed on `arena/f78d620e-banglar-tesla`; full design and evidence in
`docs/REGIONAL_FILL.md`.

- **New:** `src/world/regionFill.ts` — 48-unit regions (measured against the
  legacy interior distribution), per-region budgets of 4–8 derived from a stable
  hash of the region key, position-derived ordinals for new candidates, and a
  per-build `RegionBudgetLedger`.
- **New tests:** `regional-fill.test.ts` (28), `interior-ordinal-stability.test.ts`
  (13, Gap A), `road-corridor-index.test.ts` (8, Gap B).
- **Changed:** `city.ts` wires the ledger into both infill passes and the
  block-interior pass, adds an extension grid for new-segment areas, and scopes
  region fill to *new segments outside the shipped ±224 extent*. `layout.ts` gains
  `rebuildRoadSpatialIndex()` / stats / segment-query helpers.
- **Changed test:** `fill-isolation.test.ts` now rebuilds the corridor index (it
  previously passed only because the index could not see injected roads) and
  asserts survivors are byte-identical plus 54 evictions, instead of "0 removed".

Preserved: 845 / `c60e15b5`, 140 lanes / `52306cb0`, 656 tests / 63 files, 34
Python, build 370.16 kB, `tsc` clean, cross-process reproducible.

One full-suite run reported 654/656 and did not reproduce across five subsequent
runs (details: `docs/REGIONAL_FILL.md` §8). No test was weakened to get there.

Two corrections to earlier notes: the corridor index was **not** merely "static by
design" — it was a lifecycle defect that made injected-road collision evidence
hollow (a stale index reported a footprint clear of a road it was standing on;
§4 of `REGIONAL_FILL.md`). And the "near-road: 0 removed" result in
`INTERIOR_INFILL_ISOLATION.md` was an artifact of that defect: with a correct
index the same perturbation evicts 54 buildings, identically at `9f3e26e` and now.

## 7. The single next action

**Decide building-versus-carriageway precedence** (see §8). It is the only thing
blocking a real production road: region fill is bounded, deterministic and
corridor-safe, but a road through mapped blocks still evicts 54 shipped buildings,
40 % of them without a footprint overlap.

Before that, the cheapest useful increment: **render** a synthetic road's
neighbourhood and look at it. Region fill is numerically verified but never seen.

## 7. The single next action

**Give new regions independent fill budgets and deterministic streams.**

Right now a non-legacy fill candidate is **skipped**, because ordinals are looked up by
coordinate and a new area has none (`docs/INTERIOR_INFILL_ISOLATION.md` §3.2, §7.3). That
is deliberately conservative — it avoids reintroducing a shared counter — but it means a
road added to an unmapped area gets main-pass frontage only, with no interior fill.

Design to implement: a per-region (spatial cell or per-segment) budget with a
deterministic stream keyed by the region's stable id, derived the same way
`buildingRng.ts` derives new-segment seeds (`NEW_SEGMENT_SEED ^ hashString(id)`). The
legacy 70-segment world must stay byte-identical, verified by the same test triple:
`world-baseline`, `fill-isolation`, and a new region test.

Write the failing test first: add a road in an empty region, assert it gets interior fill,
and assert the legacy 845 are untouched.

## 8. Open product decision (still blocks road integration, needs the user)

A carriageway laid over a standing building must remove it. Measured for Mirpur Road:
18–28 legacy buildings sit within 20–40 m of the new centreline, nearest at 6.4 m — inside
the 14.05 m corridor. Measured for the synthetic test road: the 5 buildings it covered were
all *parcel* rejections, not corridor rejections (the corridor index is static — see
`docs/INTERIOR_INFILL_ISOLATION.md` §7.2), so that figure is a lower bound, not the real
displacement a real road would cause.

Options (see `docs/MIRPUR_INTEGRATION_ATTEMPT_2.md` §9.2): enumerate and accept per-corridor
displacement; choose a corridor with no building overlap (Beribadh Road, 1,786 m, 100 %
absent); or shift centrelines (rejected — trades geographic accuracy).

## 9. What NOT to redo

- **Do not re-derive the RNG offset table or the fill ordinal tables.** Both were derived
  from a real build and are pinned by tests. Procedures are in
  `docs/BUILDING_RNG_ISOLATION.md` §6 and `docs/INTERIOR_INFILL_ISOLATION.md` §6.
- **Do not re-run the visual A/B** for either milestone; both passed with pixel counts
  recorded (`BUILDING_RNG_ISOLATION.md` §4.4, `INTERIOR_INFILL_ISOLATION.md` §4.5).
- **Do not re-measure the boundary**; `npm run audit:scope` reproduces it.
- **Do not re-attempt the Mirpur patch** until §8 is decided.
- **Do not "fix" the passing mutation** in `INTERIOR_INFILL_ISOLATION.md` §7.1 by deleting
  the ordinals. They are correct; the failure mode they defend is just not reachable from
  the current fixed candidate universe.
