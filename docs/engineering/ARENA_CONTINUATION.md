# Arena Continuation Checkpoint

**This file is the resume point.** Read it first, verify the recorded commit against the
remote, then continue from §7.

---

## 1. Identity

| Field | Value |
|---|---|
| Branch | `arena/f78d620e-banglar-tesla` |
| Base commit | `2dc02d7` (branch point, per Arena) |
| **Checkpoint commit** | **`73abdca`** (code `2824bdb`, then the handover text) |
| Remote (verified via `git ls-remote`) | `arena/f78d620e-banglar-tesla` = **`73abdca`** (`62e3ee3..73abdca`, fast-forward) |
| Production `main` | `84e79e4` — **untouched, never merged, never pushed** |
| Push method | fast-forward only, verified after every push |

## 2. Session log (real timestamps, UTC)

| Session | Start | End | Commits produced |
|---|---|---|---|
| 2026-11-12 (earlier) | ~04:03 | ~04:20 | `f134e41`, `2e4d3a2`, `316ccf8`, `b57dd33` |
| 2026-11-12 (this one) | ~05:31 | ~06:00 | `583654c` |
| 2026-11-12 (audit) | ~15:0x | ~15:4x | `dac11e5`, `f257cd8`, `92c6299`, `62e3ee3` (synthetic-road audit) |
| 2026-11-12 (frontage fix) | ≤15:56 (first artefact) | 16:2x | **`2824bdb`**, `73abdca` (this handover) |

Times are from the sandbox clock and file timestamps, not estimated: the frontage
fix session spans roughly **30 minutes**, and the whole campaign remains well under
two hours. No longer-runtime claim is made.

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
| `dac11e5` → `62e3ee3` | Synthetic-road impact audit: 54 evictions measured, 35 collateral, 4 commits |
| **`2824bdb`** | **Frontage accept/reject isolation: 54 → 19 evictions, 0 collateral, world still `c60e15b5`** |

## 4. Verified state at this checkpoint

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Unit/integration | `npx vitest run` | **607 passed / 60 files** |
| Python (OSM import) | `python3 -m unittest discover -s tests/map_import` | **34 OK** |
| Production build | `npm run build` | exit 0, **369.27 kB gzip** |
| World baseline | `tests/unit/world-baseline.test.ts` | **845 / `c60e15b5`, no drift** |
| Fill isolation | `tests/unit/fill-isolation.test.ts` | **19 passed** (evicts 19 by `synth_near`, §6c) |
| Frontage isolation | `tests/unit/frontage-isolation.test.ts` | **3 passed** (new, §6c) |
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
  asserted survivors are byte-identical plus evictions, instead of "0 removed"
  (now 19, see §6c).

Preserved at that checkpoint: 845 / `c60e15b5`, 140 lanes / `52306cb0`, 656 tests /
63 files, 34 Python, build 370.16 kB, `tsc` clean, cross-process reproducible.
(Superseded by §6c: 659 tests / 64 files, build 370.99 kB.)

One full-suite run reported 654/656 and did not reproduce across five subsequent
runs (details: `docs/REGIONAL_FILL.md` §8). No test was weakened to get there.

Two corrections to earlier notes: the corridor index was **not** merely "static by
design" — it was a lifecycle defect that made injected-road collision evidence
hollow (a stale index reported a footprint clear of a road it was standing on;
§4 of `REGIONAL_FILL.md`). And the "near-road: 0 removed" result in
`INTERIOR_INFILL_ISOLATION.md` was an artifact of that defect: with a correct
index the same perturbation evicts 54 buildings, identically at `9f3e26e` and now.

## 6b. Synthetic road impact audit — DONE (`dac11e5`)

Diagnostic only, nothing in `src/` changed; full report in
`docs/SYNTHETIC_ROAD_AUDIT.md`, evidence in `diagnostics/synthetic-road-audit/`
(one removable directory, absent from the game bundle).

The 54 evictions caused by `synth_near` decompose as **19 genuine conflicts**
(17 footprints under the asphalt, 2 in the sidewalk+setback band) and **35
collateral** (29 re-rolled by an upstream rejection, 6 by a later pass). The
"removed because the new road is now its nearest road" hypothesis is disproved:
19 buildings gain that attribution and all 19 are genuine conflicts.

Mechanism: `buildCity()` uses one `bRng` per **segment**, walking side −1 then
+1, so one rejected candidate (3 draws, +4.5 m) re-rolls every later candidate
on both sides of that segment. `babar_1` loses 15 buildings while 70.9 m from
the road. Six independent short-stub trials reproduce it: 84 evicted, 35
genuine, 49 collateral (58 %).

Verified against `9f3e26e`: identical 54 eviction keys and identical class
counts. Gates at that time: tsc clean (game + diagnostic), 656 tests, 34 Python,
build 370.16 kB, world still 845 / `c60e15b5`.

## 6c. Frontage coupling — FIXED (`2824bdb`)

The 35 collateral evictions were a defect, not a policy question, and are now gone.
Root cause: the frontage walk's *state* depended on its *outcomes*. A rejected
candidate advanced `along` by 4.5 m and consumed 3 draws; an accepted one advanced
by `bWidth + gap` and consumed 7 (8 on a gali) from one shared per-segment
generator. So one rejection re-rolled the rest of that segment's frontage on both
sides.

Fix (`src/world/city.ts`, new `src/world/frontageLayout.ts`):

- every draw a candidate will ever use is taken **before** the fit test, in the
  order the accepted path always took them; `canPlaceBuilding()` is now a pure
  filter;
- one advance for both outcomes (`bWidth + gap`), so a rejection can only remove
  that candidate;
- the shipped accept/reject sequence is frozen (140 frontages, 1210 steps, 564
  accepted) because the 845-building world *is* the product of the coupled walk.
  New segments have no frozen sequence and are decided live.

| | before (`62e3ee3`) | after (`2824bdb`) |
|---|---|---|
| shipped world | 845 / `c60e15b5` | 845 / `c60e15b5` |
| evicted by `synth_near` | 54 | **19** |
| carriageway-overlap / corridor-clearance | 17 / 2 | 17 / 2 |
| frontage-reroll / unexplained | 29 / 6 | **0 / 0** |
| six-stub experiment | 84 / 35 / 49 | **34 / 34 / 0** |
| control road 700 m away | 0 | 0 |

The 19 are a strict subset of the old 54: same keys, same classes, zero new
losses, max asphalt intrusion still 9.00 m. Reproduced byte-identically in two
separate processes. A road on empty land (no rejections) produces the *identical*
world before and after (`a90a7ef7`), so the change is inert outside rejections.
Cost: buildings within 26 m of the new road 75 → 72 (−4 %).

New regression test `tests/unit/frontage-isolation.test.ts` (3 tests) — it fails
on the pre-fix walk with `expected 54 to be less than or equal to 20`. Two older
tests that pinned "54 evictions" now pin 19; their real assertions (no survivor
resized, fill adds nothing) are unchanged.

Gates at `2824bdb`: `tsc` clean (game + diagnostic), **659 tests / 64 files**, 34
map-import + 5 apk-pipeline Python tests, build 370.99 kB gzip (+0.83 kB for the
frozen table), `git diff --check` clean, capture `errors: none`, no diagnostic code
in `dist/`.

One self-inflicted error, recorded because it invalidated two probe runs: a
`cp /tmp/city.new1.ts src/world/city.ts` restore overwrote the in-progress fix, so
the first density comparison ran against a 797-building build. It was caught by a
digest mismatch, re-fixed, and every number above was re-measured afterwards.

## 7. The single next action

**Decide building-versus-carriageway precedence** (see §8). It is the only thing
blocking a real production road: region fill is bounded, deterministic and
corridor-safe, but a road through mapped blocks still evicts 54 shipped buildings,
65 % of them without a footprint overlap (§6b).

That decision now has numbers behind it, and the defect is out of the way: of the
original 54 removals, 35 were collateral from the frontage-walk cascade and are
fixed (§6c); **19 are genuine conflicts** and are the only ones the precedence
policy has to decide.

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
