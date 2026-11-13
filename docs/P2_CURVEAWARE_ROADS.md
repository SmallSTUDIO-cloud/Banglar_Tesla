# P2 — curve-aware road architecture: plan, classification and progress

**Status:** slices 1–3 complete and verified. Remaining slices documented, not started.

| | |
|---|---|
| Starting commit | `b22098f` (P1 collinear prototype) |
| Branch | `arena/f78d620e-banglar-tesla` |
| P3 | **not started** — real OSM alignment, median modelling and junction moves remain blocked |

---

## 1. What P1 did and did not prove

P1 proved the *plumbing*: a segment can carry an optional centreline, and derivation,
sampling, rendering and minimap all work when it does. It did **not** make the game
curve-aware, because a collinear centreline exercises the new code paths while
producing identical numbers.

The gap P2 closes is the one where a curved centreline would produce **wrong answers
silently**: the functions that answer *"where is the road nearest this point?"*.

---

## 2. Classification of chord-arithmetic call sites

Method, reproducible: count code lines (comment-only lines excluded) matching
`\.(ax|az)\s*\+\s*\w+\.(ux|uz)\s*\*` (point-at-distance) or `\.leftX\s*\*|\.leftZ\s*\*`
(lateral offset), across `src/**/*.ts`.

Measured at `b22098f`: **102 point-at-distance lines + 50 lateral-offset lines = 152**.

> Note on "214": earlier phases reported ~214 curve-sensitive references using a broader
> pattern that I cannot reproduce from the current tree. The figure below is what the
> stated method actually yields; it is not adjusted to match the earlier number. The
> per-file totals also differ from the earlier inventory because that one counted every
> `ux`/`uz` reference including pairs, whereas this counts lines.

| File | point | lateral | Class | Why |
|---|---:|---:|---|---|
| `world/city.ts` | 48 | 25 | **2 — incorrect for curves** | Asphalt, markings, kerbs, zebra, sidewalk slabs and building placement all reconstruct positions from the chord frame. Migrated all → P2 slice 4+. |
| `world/layout.ts` | 8 | 6 | **2 → migrated** | Projection, clearance and approach poses. Slices 1 and 3. |
| `world/corridorIdentity.ts` | 7 | 4 | **2** | Corridor decor placement along the chord. |
| `ai/pedestrians.ts` | 3 | 6 | **2** | Pedestrian paths along the chord. |
| `world/marketApron.ts` | 6 | 2 | **2** | Market apron geometry. |
| `world/props.ts` | 6 | 2 | **2** | Stalls, carts, furniture placement. |
| `blacklist/raceRoutes.ts` | 4 | 2 | **2 / 5** | Gate placement (2, now served by migrated `snapToNearestRoad`); route distance totals (5 — deliberately chord-based, see §4). |
| `world/roadGeometry.ts` | 4 | 2 | **3 — already polyline-aware** | This *is* the polyline implementation; the patterns are the span maths. |
| `ai/roadblocks.ts` | 4 | 0 | **2** | Roadblock span placed across the chord normal. |
| `ai/traffic.ts` | 4 | 0 | **3** | Operates on `LaneEdge`, not segments. Lane-local chords are exact by construction. |
| `missions/roadside.ts` | 2 | 1 | **2** | Roadside mission target placement. |
| `game.ts` | 2 | 0 | **2** | Player-relative segment probe. |
| `ai/police.ts` | 2 | 0 | **3** | Operates on lane edges for patrol geometry. |
| `ai/routes.ts` | 2 | 0 | **3** | `sampleLane` — the definition of lane geometry itself. |

**Class 1 (correct for straight roads and still correct):** lane construction in
`routes.ts` builds node-to-node lanes. On a curved segment these remain correct *as lanes*
because a lane is a straight span by definition; the extension is to emit N lane spans per
segment, which is a deliberate, separately-tested change (not done).

**Class 4 (unrelated):** none found by this pattern.

---

## 3. Why traffic and lanes are class 3, not a defect

`sampleLane(lane, s, nudge)` places a vehicle from the **lane's** own chord, and traffic
advances `agent.s` to `lane.length`. Junction turns already use cubic Béziers. Curvature is
therefore already representable at the lane layer — the work is to subdivide a segment into
spans and emit 2N lanes, at which point vehicle motion needs no change at all. That is why
P2 focused on the projection layer first: it is where a curve produces *silently wrong
answers* with no lane-layer involvement.

A known risk for that future work is recorded in the P1 design: `traffic.ts` finds a
reverse lane with `.find(fromNode === lane.toNode)`, which would pick the wrong span once
lanes subdivide. It must be replaced by an explicit `reverseLaneId` before any lane
subdivision. Not touched here.

---

## 4. Chord length vs arc length — the rule held throughout

`seg.length` is still the **chord**. Arc length is a separate query, `arcLengthOf(seg)`.
No consumer was switched from chord to arc length, with two deliberate exceptions where the
value is a *position* rather than a *distance*:

- `makePlaceOnSegment` now takes a fraction of **arc** length. For straight and collinear
  segments this is numerically identical.
- `pointToSegmentDistance().t` is normalised by arc length. Its documented meaning
  ("fraction along the road, 0..1") is unchanged.

Route totals and race distances were **not** touched. `findRoute` still costs edges by
`seg.length` and still emits node centres, so race distances continue to measure chords.
That keeps all 17 events, every deadline and every shortcut saving identical — verified by
zero gameplay-baseline drift.

---

## 5. Implemented slices

### Slice 1 — projection layer (`a0608fc`)

`projectOntoSegment`, `makePlaceOnSegment`, `makePlaceAtLandmark`, `snapToNearestRoad`.

Added `nearestOf()` to `roadGeometry.ts`: a pure, generic segment search, so selection
logic can be tested against synthetic curved geometry that cannot be injected into the real
graph. `snapToNearestRoad` now delegates to it; the margin (`min(4, length*0.2)`) and the
gali rule are unchanged.

**Equivalence:** a 3,196-point world-space grid reproduces the legacy chord implementation
to <1e-9 in segment choice, position and yaw — and again with gali excluded.

**Defect demonstrated:** on a synthetic 90° corner, a point 2 units from the road is
measured ~11 units away by the chord. That is the class of error the migration removes.

### Slice 2 — navigation (`04539e8`)

`mapRouting.nearestRoad`, which `poiReach` gates routability on. A chord overstates the
offset near a curve, which can push a genuinely served POI past
`POI_ROAD_MAX_OFFSET_M = 45` and make it permanently unroutable.

**Equivalence:** a 4,536-point grid matches legacy exactly in segment choice, distance
(1e-9) and closest point (<1e-9). A sweep asserts no point flips from routable to
unroutable — polyline distance is never larger than chord distance, so the only permitted
change is a false negative being repaired.

### Slice 3 — clearance and approach poses (`86160f0`)

`pointToSegmentDistance`, `distanceToRoadCarriageway`, `distanceToRoadCorridor`,
`placeApproachPose`.

**Equivalence:** 2,450 cases for `pointToSegmentDistance` (dist, cx, cz, t); 1,050
near-road points for both clearance queries; every segment midpoint reports on-asphalt;
every approach pose lands within its own segment half-width.

**Limitation discovered and pinned, not hidden:** the two clearance queries search a
spatial bucket rather than the whole graph, so they return an **upper bound** — measured
54.08 reported vs 34.58 true for a segment in a neighbouring cell, and a 999 sentinel for
cells containing no road. This is pre-existing bucket behaviour independent of the
projection change. Tests assert the property (*never closer than truth*) instead of
pretending to a global-minimum guarantee.

### F1 — dangling citation (`a9fb190`)

`units.ts` cited `docs/ASAD_AVENUE_ARCHITECTURE_REVIEW.md §4.2` for "2.35x too wide". That
document is untracked, and its figure does not hold up:

- its table pairs a **12.2** stored width with a **14.4 m** denominator;
- 14.4 appears exactly once in the whole document — inside the calculation, never derived;
- §5 separately marks the carriageway width **[U]** (an importer estimate).

The existing test already asserted `METERS_PER_WORLD_UNIT` (2.7778) and passed — so the
comment and the code disagreed, not the code and the arithmetic. The comment now states the
figure that follows from tracked constants alone: a metre value placed in the compressed
space is exactly `1 / WORLD_SCALE = 2.7778×` too wide. The test's precision was tightened
from 2 decimals to 9, and a canary now asserts the hardcoded `asad_4` figures still match
the live graph so the demonstration cannot rot.

The review document itself was **left untracked and unmodified**: it is design material for
unapproved P3 work, and correcting its §4.2 in place would be rewriting research rather than
publishing it.

### F2 — dirty build stamp: deliberately not changed

`vite.config.ts` stamps `-dirty` when `git status --porcelain` is non-empty, so five
untracked carry-over files make any local build read `b22098f-dirty`.

Examined and decided **not** to change it:

- the stamp is display-only (`APP_BUILD_LABEL` in the settings footer, plus the perf
  benchmark report); no logic parses `-dirty`;
- suppressing untracked files from the dirty check would make the provenance *less*
  honest — a build from a tree containing uncommitted work is genuinely dirty;
- editing build-provenance configuration for cosmetics falls outside this mission's scope.

The correct fix is for the human owner to decide what to do with the five carry-over files.
No release will be published, and no claim of a clean artifact is made.

---

## 6. Remaining P2 work (not started)

Ordered by value, each requiring the same evidence standard as slices 1–3:

1. **`city.ts` placement and surface (class 2, 73 lines).** The largest remaining group.
   Highest risk: building placement feeds the world baseline (845 buildings), so an
   arithmetically-equivalent migration is mandatory before any geometry change.
2. **`props.ts`, `marketApron.ts`, `corridorIdentity.ts`, `pedestrians.ts`,
   `roadside.ts`, `roadblocks.ts`, `game.ts` (class 2, ~39 lines).** Same pattern,
   smaller blast radius.
3. **Lane subdivision (N spans per segment, 2N lanes).** Blocked on replacing the
   reverse-lane `.find` in `traffic.ts` with an explicit `reverseLaneId`, and would change
   the lane baseline (140 lanes) — requires baseline-update approval.
4. **Race distance semantics.** `findRoute` still emits node centres, so route totals
   understate a curved road. Changing this moves `totalDistanceM` for any course touching
   a curved segment and can flip the 13 of 17 events that currently have zero deadline
   margin. Requires explicit approval and a documented deadline review.

---

## 7. P3 blockers (unchanged)

1. Verified median vertices for `asad_4` cannot be inserted while `town_hall` (42,106) and
   `asad_post` (118,84) stay fixed: the interior vertex at x=119.74 lies east of
   `asad_post`, so the road would fold back past its own endpoint.
2. A lane-id save/telemetry check is still unanswered for span-suffixed lane ids.
3. Median continuity outside the photographed stretch is unverified **[U]**.
