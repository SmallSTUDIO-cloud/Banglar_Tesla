# Gameplay baseline and drift protection

## Why this exists

Every gameplay distance in this project is **derived at runtime** from road
segment endpoints. `RoadSegment` (`src/world/layout.ts`) computes `length`,
`ux/uz`, `leftX/leftZ` and `halfWidth` from `ax,az,bx,bz`. Races, shortcuts,
traffic, missions, pickups and place markers all read those derived values.

The consequence, measured rather than assumed: in the first Asad Avenue alignment
attempt, **one segment edit** (adding a single OSM vertex to `asad_4`) produced

- 9 segments re-lengthed, 5 of them unrelated cross-streets by 8–12 units,
- 11 of 17 race distances changed,
- 3 of 14 shortcut savings changed, `sc_bazar_gali_10` from 13 → 3 units,
- 4 place markers dragged (including a *landmark-anchored* one),
- 2 test failures.

Full measurement: `docs/ASAD4_ALIGNMENT_EXPERIMENT.md`.

Nothing detected that until the tests were run, and even then the failures
("bazaar marker > 15 m", "ev_street_asad deadline") did not name the eleven
numbers that had actually moved. This baseline closes that gap.

## What is protected

`data/mohammadpur/gameplay-baseline.json` holds a snapshot of:

| Area | Records | Fields compared |
|---|---:|---|
| Road nodes | 42 | `id, x, z` |
| Road segments | 70 | `id, from, to, ax, az, bx, bz, length, width, kind` |
| Places | 14 | `id, segmentId, x, z` |
| Landmarks | 9 | `id, frontageSegmentId, x, z` |
| Race courses | 17 | `eventId, startSegmentId, startBanner, gateCount, gateSample, totalDistanceM, gridSlots, deadlineSeconds` |
| Shortcuts | 14 | `id, mainDistanceM, shortcutDistanceM, savingM` |
| AI reference times | 17 | `aiReferenceTimesS` (deterministic simulation) |

Values are **game units** (1 unit = 2.778 real m) except `segments[].width`,
which is authored in real metres. `aiReferenceTimesS` are simulation outputs,
**not** device or human measurements.

## How it works

`tools/gameplaySnapshot.ts` is the single implementation. Two consumers share it
so they cannot disagree:

- `tools/snapshot-gameplay.ts` — CLI, prints the JSON.
- `tests/unit/gameplay-baseline.test.ts` — drift test.

`tools/snapshotDiff.ts` walks both snapshots and emits one entry per changed
leaf, keyed by path. Arrays of records are matched **by id, not by index**, so
reordering does not masquerade as a change and a renamed id is reported as
`MISSING` / `UNEXPECTED` rather than a silent shift.

### Failure output

A one-unit nudge to `town_hall.z` produces:

```
9 gameplay value(s) changed since the golden baseline was accepted:

    nodes[town_hall].z
        baseline: 106
        current : 107
    segments[asad_3].length
        baseline: 62.65
        current : 62.24
    segments[asad_4].length
        baseline: 79.12
        current : 79.4
    segments[zakir_1].length
        baseline: 74.67
        current : 73.74
    segments[shershah_1].length
        baseline: 92.35
        current : 93.3
    ...
```

The collateral on `zakir_1` and `shershah_1` is the point: the test names the
damage that a human review would otherwise miss.

## Changing the baseline on purpose

The baseline is never edited to make a red test go green. Regeneration is gated:

```bash
# 1. Dry run — prints the exact diff, writes nothing, exits 1 if there is drift.
npm run baseline:update

# 2. Review the diff. If the change is intended, accept it with a reason.
BASELINE_ACCEPT="re-anchored Asad corridor to the OSM median; deadline re-authored" \
  npm run baseline:update

# 3. Commit both the source change and the regenerated JSON together.
```

`BASELINE_ACCEPT` is written into the file as `acceptedReason`, so the commit
carries its own justification. The JSON diff is reviewable in the pull request
like any other file.

Refusing without a reason is deliberate: it makes "I just wanted the test to
pass" a visible act rather than an accident.

## Determinism

The test builds the snapshot **twice in the same process** and asserts byte
equality, then separately asserts the live build matches the golden payload.
AI timing uses a zeroed RNG (`new RivalRaceSystem(() => 0)`) and fixed 1/60 s
steps, mirroring `tests/unit/vnext-race-timing.test.ts`.

If the determinism test ever fails, treat the *other* failures as noise until it
is fixed — the baseline is only meaningful if the same commit always produces the
same JSON.

## Known limitations

- **The update script is not covered by `tsc`.** `scripts/update-gameplay-baseline.ts`
  uses `node:fs`/`node:path`, but this repo's `tsconfig.json` sets
  `types: ["vite/client"]` and does not install `@types/node`, and `include`
  covers only `src`, `tests/unit` and `vite.config.ts`. Widening that was judged
  out of scope for baseline protection (it changes the type environment for all
  application code). The script was instead verified by **running it**: refusal
  without approval (exit 1, diff printed), acceptance with a reason (file
  written, `acceptedReason` recorded), then restored. The shared logic it depends
  on (`tools/gameplaySnapshot.ts`, `tools/snapshotDiff.ts`) *is* typechecked,
  because the drift test imports them.
- **The baseline covers derived values, not rendered geometry.** It cannot catch
  a building placed inside a road; that needs the geography checks.
- **`aiReferenceTimesS` is a single deterministic run**, not a distribution. It
  catches "the course got longer" but says nothing about frame rate or device
  behaviour.
- 16 `artifacts/shot-*.png` are absent from the development sandbox; they are
  images, not runtime inputs, and are unrelated to these values.
