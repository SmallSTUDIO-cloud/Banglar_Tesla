# Arena Continuation Checkpoint

**This file is the resume point.** Read it first, verify the recorded commit against the
remote, then continue from §7.

---

## 1. Identity

| Field | Value |
|---|---|
| Branch | `arena/f78d620e-banglar-tesla` |
| Base commit | `2dc02d7` (branch point, per Arena) |
| **Checkpoint commit** | **`316ccf8`** |
| Remote (verified via `git ls-remote`) | `arena/f78d620e-banglar-tesla` = `316ccf8` |
| Production `main` | `84e79e4` — **untouched, never merged, never pushed** |
| Push method | fast-forward only, verified after every push |

## 2. Session log (real timestamps, UTC)

| Session | Start | End | Commits produced |
|---|---|---|---|
| 2026-11-12 (this one) | ~04:03 | ~04:20 | `f134e41`, `2e4d3a2`, `316ccf8` |

Cumulative campaign time is **under one hour of wall-clock execution**, not the eight-hour
target. No claim of longer runtime is made.

## 3. Campaign commits (oldest first)

| Commit | What |
|---|---|
| `f134e41` | Isolate building RNG: per-segment pinned legacy streams + pinned litter stream |
| `2e4d3a2` | Boundary-clipped map scope audit; coverage 32.3 % → 16.4 %; Mirpur 1,704 m |
| `316ccf8` | Mirpur attempt 2 measured and reverted; two structural couplings documented |

## 4. Verified state at this checkpoint

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Unit/integration | `npx vitest run` | **588 passed / 59 files** |
| Python (OSM import) | `python3 -m unittest discover -s tests/map_import` | **34 OK** |
| Production build | `npm run build` | exit 0, **366.20 kB gzip** |
| World baseline | `tests/unit/world-baseline.test.ts` | **845 / `c60e15b5`, no drift** |
| Lane baseline | `tests/unit/lane-graph-baseline.test.ts` | **140 lanes / `52306cb0`** |
| Scope audit | `npm run audit:scope` | 3.541 km² ring, 93,551 m in scope, **16.4 %** |
| Road audit | `npm run audit:roads` | 47,422 m in box, 15,337 m graph, 32.3 % (unchanged) |

## 5. Workspace state

- Working tree clean except three **user-owned untracked** paths that must never be deleted
  or committed blindly:
  - `docs/ASAD_AVENUE_ARCHITECTURE_REVIEW.md`
  - `docs/PHASE1_POLYLINE_ROAD_DESIGN.md`
  - `image-search/`
- `node_modules/` is **not persisted** across sandbox restores. Run `npm ci` first.
- No worktrees left behind (`git worktree list` shows only the main tree).

## 6. Known environment hazard (recurring)

**Every fresh sandbox has shown an empty git index and a HEAD reset to the branch base
(`2dc02d7`).** This makes the entire repository look modified or deleted. It is not — the
remote is authoritative.

Recovery, non-destructive, in this order:

```bash
git fetch origin arena/f78d620e-banglar-tesla
git read-tree <verified-tip-sha>
git update-ref refs/heads/arena/f78d620e-banglar-tesla <verified-tip-sha>
git status --short          # expect only the three untracked paths in §5
```

Never use `git reset --hard`, `git checkout -- .`, `git clean`, or `git restore .` to
recover. Verify `/dev/null` exists (`crw-rw-rw- 1 root root 1, 3`) before long command
sequences; if it is missing, stop and request a fresh sandbox — do **not** attempt repair.

## 7. The single next action

**Implement block-interior and infill isolation** (`docs/MIRPUR_INTEGRATION_ATTEMPT_2.md`
§9.1). This needs **no product decision** and preserves the current world exactly.

Target contract, testable in both directions:

1. With the current 70 segments, output must stay **byte-identical** (845 buildings,
   digest `c60e15b5`). Anything else is a bug in the fix.
2. With synthetic segments added anywhere, the **legacy** buildings must not change at all.

Approach (from the measured evidence):

- Scope the interior pass's `roadDistance` and `snapToNearestRoad` to **legacy segments**.
- Compute interior `gap` from a `placedBuildings` snapshot taken **before** new segments
  contribute.
- Freeze the infill budget the same way (cap 112, per-sector cap 8).
- The mutable `interiorCount` counter is the hard part: a single extra/fewer rejection
  shifts every later dimension. Prefer making each candidate's dimensions a pure function
  of a stable candidate key, but **only** if the legacy 131 interior buildings can be
  reproduced exactly — otherwise keep the counter and guarantee the rejection sequence is
  unchanged.

Write the mutation test first: add a far-away segment and assert zero legacy change. It
must fail now, and pass after the fix.

## 8. Open product decision (blocks Phase 4, needs the user)

A carriageway laid over a standing building must remove it. Measured for Mirpur Road:
**18–28 legacy buildings sit within 20–40 m of the new centreline**, the nearest at
**6.4 m** — inside the 14.05 m corridor.

Options, none of which should be chosen silently:

- (a) Enumerate the displaced footprints per corridor, show before/after screenshots, and
  relax the gate to "all 845 unchanged **except N enumerated footprints**".
- (b) Pick a corridor with no building overlap first — **Beribadh Road** is 1,786 m,
  100 % absent from the graph, and the largest measured gap.
- (c) Shift the centreline to dodge buildings — **rejected**: it trades geographic
  accuracy for convenience.

## 9. What NOT to redo

- Do not re-derive the RNG offset table. It was re-derived independently from pristine
  `c56eb4a` and matched all 70 values exactly (`/tmp` artifacts are gone; the procedure and
  results are in `docs/BUILDING_RNG_ISOLATION.md` §6).
- Do not re-run the visual A/B for the RNG milestone; it passed and is recorded with pixel
  counts in `docs/BUILDING_RNG_ISOLATION.md` §4.4.
- Do not re-measure the boundary; `npm run audit:scope` reproduces it and
  `tests/unit/map-scope.test.ts` pins it.
- Do not re-attempt the Mirpur patch without doing §7 first; it will fail the same way.
