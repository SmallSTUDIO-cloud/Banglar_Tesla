# Phase 1 — collinear subdivision prototype (`asad_4`)

**Scope approved:** P1 only. P3 (real curved OSM geometry) is **not** done and not
started.

Starting checkpoint `0e528f3`. Branch `arena/f78d620e-banglar-tesla`.

| | |
|---|---|
| Road segments | **70** (unchanged) |
| Junction nodes | **42** (unchanged) |
| Traffic lanes | **140**, two per segment (unchanged) |
| Segments with a polyline | **1** — `asad_4` only |
| Gameplay baseline | **zero drift** |
| World baseline | **zero drift** (845 buildings, digest `c60e15b5`) |
| Lane-graph baseline | **zero drift** (140 lanes, digest `52306cb0`) |

---

## 1. What the prototype actually does

`asad_4` (town_hall → asad_post) is given an authored centreline of three vertices at
0 %, 50 % and 100 % of its existing chord:

```ts
vertices: [ {x:42, z:106}, {x:80, z:95}, {x:118, z:84} ]
```

The polyline is **exactly collinear** with the chord it replaces. Therefore:

| Quantity | Before | After | Delta |
|---|---|---|---|
| Chord length | 79.12016177940994 | 79.12016177940994 | **0** |
| Polyline arc length | — | 79.12016177940994 | **0** |
| Render strips (asphalt boxes) | 1 | 2 | +1 |
| Span length | 79.12016177940994 | 39.560081 + 39.560081 | 0 |
| Span heading | 106.144338780° | 106.144338780° (both) | 0 |
| Max joint turn | — | **0°** | — |

Because both spans carry the *same* yaw as the original chord, the two half-boxes are
collinear halves of the original box. Total depth is conserved, width is conserved,
area is conserved, and the joint abuts exactly (`span0.s1 === span1.s0`, exact
equality, not tolerance).

**This changes no geometry.** It exercises the entire polyline pipeline — derivation,
span caching, sampling, projection, rendering, minimap — on a heavily referenced
segment while every golden baseline stays silent.

---

## 2. Files changed

| File | Change |
|---|---|
| `src/world/roadGeometry.ts` | **New.** Polyline derivation, `poseAt`, `offsetPoint`, `projectOntoPolyline`, `arcLengthOf`, `renderStrips`, `maxJointTurnDeg`. |
| `src/world/layout.ts` | `RoadSegment.vertices?`; `Vec2` import; the `COLLINEAR_SUBDIVISIONS` table (`asad_4` only) + `applyCollinearSubdivisions()`. |
| `src/world/city.ts` | Asphalt ribbon drawn **once per span** instead of once per segment. Removed the two now-unused chord-midpoint locals. |
| `src/ui/mapScreen.ts` | Minimap road drawn as a polyline (`moveTo` + one `lineTo` per span) instead of a single chord `lineTo`. |
| `tools/laneGraphSnapshot.ts` | **New.** Lane snapshot + order-independent FNV-1a `laneDigest`. |
| `tools/snapshot-lanegraph.ts` | **New.** CLI dump. |
| `scripts/update-lane-graph-baseline.ts` | **New.** Reviewed regeneration (prints diff, refuses without `BASELINE_ACCEPT`). |
| `data/mohammadpur/lane-graph-baseline.json` | **New.** Golden lane layer, 140 lanes. |
| `tests/unit/lane-graph-baseline.test.ts` | **New.** 14 tests. |
| `tests/unit/road-geometry.test.ts` | **New.** 29 tests. |
| `package.json` | `baseline:update-lanes`, `snapshot:lanes`. |

**`src/ai/routes.ts` is untouched** — `git diff HEAD -- src/ai/routes.ts` is empty. No
lane-generation code was modified. No race, traffic-behaviour, mission, building or POI
code was modified.

---

## 3. Lane-graph protection (established first)

The lane layer was the one derived structure with **no** golden coverage, even though it
moves *before* any authored field does. It is now pinned before any geometry work:

- `getLaneGraph()` is a pure function of `ROAD_SEGMENTS` + `GRAPH_NODES`, so it
  snapshots directly in Node.
- Pinned per lane: id, segment, direction, both endpoints, tangent, yaw, length, road
  width, kind, signal attachment, and **`nextLaneIds`** junction topology.
- Digest is order-independent over the lane *set* (sorted inside `laneDigest`, not only in
  the builder).

**A bug in my first version was caught by my own test** and fixed: the digest hashed the
array in given order, so reordering lanes changed it while the docstring claimed
order-independence. `laneDigest` now sorts internally; the golden digest stayed
`52306cb0` because the builder already sorted.

Structural tests assert, independently of the digest: exactly 2 lanes per segment, ids
`<seg>:fwd` / `<seg>:rev`, endpoints resolving to real junction nodes, every
`nextLaneId` leaving the correct node, U-turns only offered when no continuation exists,
each lane collinear with its segment chord and equal in length to it.

Five in-memory mutation proofs confirm the digest detects a moved lane, a changed lane
length, a **topology-only** change with geometry identical, a reversed direction, and a
1e-6 yaw change — and that it ignores a reordered list.

---

## 4. Chord vs arc length — kept explicitly distinct

`seg.length` **still means the chord** between the two junction nodes and was not
redefined. Polyline length is a separate query, `arcLengthOf(seg)`.

A stored `arcLength` field was rejected: two stored lengths can drift out of sync, a
function cannot. With no `vertices` the two are equal by construction, so no existing
distance consumer changes meaning. Tests assert both that they agree for straight and
collinear geometry, and that they **diverge** once a centreline is genuinely curved
(a synthetic 2-span arc is strictly longer than its chord) — so the two can never be
silently conflated.

---

## 5. Test results

| Check | Result |
|---|---|
| `npm run typecheck` | **clean** |
| `npm test` | **483 / 483 passing, 50 files** (was 440/48; +43) |
| `npm run build` | **365.18 kB gzip** (was 364.62; +0.56) |
| Gameplay baseline | **no drift** |
| World baseline | **no drift** — 845 buildings, digest `c60e15b5` |
| Lane-graph baseline | **no drift** — 140 lanes, digest `52306cb0` |

New tests: 14 lane-graph + 29 road-geometry.

Mutation proofs run and reverted:

| Mutation | Caught |
|---|---|
| 1 cm gap at each span joint | **8 tests failed** (seam contiguity, footprint, area, span bounds); restored → 29/29 |
| Lane moved 0.01 unit | lane digest changes |
| Lane length +0.5 | lane digest changes |
| `nextLaneIds` trimmed, geometry identical | lane digest changes |
| Lane direction reversed | lane digest changes |
| Lanes reordered | lane digest **unchanged** (correct) |

### Two real bugs found by my own tests, and how they were fixed

**Bug 1 — `poseAt` extrapolated off the road.** Out-of-range `s` selected the first/last
span but still computed `t = s - s0`, so `s = -50` produced a point 48 units past the
junction. Now `t` is clamped into the span. Regression test covers `-50` and `s+50`.

**Bug 2 — a design flaw, not a code bug.** My first version implemented a resampler:
split any span whose joint exceeded 6° until every joint passed. It cannot converge —
splitting a straight span inserts a point *on* the straight line, so the turn at the
span's far joint is never reduced. It exhausted its pass limit and returned invented
vertices, which is why "16 spans expected" became 26.

Chasing it produced a worse realisation: **an auto-resampler would relocate a road
someone verified against real data and would quietly shorten arc length by corner
cutting.** The design was wrong in principle, not just in implementation. It was
replaced with 1:1 vertex→span mapping (geometry is never invented) plus
`maxJointTurnDeg()` as a *budget to check* rather than a smoothing target. If a real
centreline needs more vertices to stay smooth, they must be authored from verified
geometry. A test now pins the 90° synthetic corner to exactly 2 spans and arc length
exactly 20 — no corner cutting.

---

## 6. Screenshots and render verification

Fixed free-camera views of `asad_4` plus the minimap, shot from the **subdivision build**
and the **plain-chord build** (subdivision table emptied, rebuilt, then restored — source
restored byte-exactly, sha256 `68dfdf0c…`). Files are in `artifacts/`, which is
gitignored, so no image enters the commit.

Same-build repeat runs confirmed three of five views are byte-identical run-to-run, so
the harness is deterministic; the other two vary in antialiasing only.

| View | Differing pixels | Verdict |
|---|---|---|
| `seam-cross` (perpendicular at joint), lower 326,400 px | **0** | **identical** |
| `seam-air` (overhead), asphalt region | **0** of 76,800 in footprint mask | **identical footprint** |
| `seam-air`, whole frame | 5,400 px > 10 % | **entirely the UI toast** |
| `seam-close` (0.85 m above surface at joint) | 1,157 px > 10 % | sub-perceptual AA noise |
| `seam-along` (grazing along carriageway) | 3,635 px > 10 % | AA noise on thin dashes/kerbs |
| `minimap` | 10 px, max Δ 19/255, **0 px > 10 %** | sub-perceptual |

Road-region statistics (640×120 crop, excluding UI): mean absolute difference
**0.83/255**, 0.004 % of pixels above 10/255. Amplified 7×, the residual is uniform
surface noise with **no line at the joint**.

**The one explained difference:** the plain-chord shots show a transient mission toast
("ফিরে যান — বাংলাদেশের ঘুরে দেখুন") that the subdivision shots lack. It is a
timing-dependent UI notification, not geometry. Excluding the toast's screen band drops
`seam-cross` to **0 differing pixels**.

Because a screenshot claim should not be the only evidence, the seam is also proven
mathematically: strips abut with **exact** float equality (`span0.s1 === span1.s0`), total
depth, width, yaw and area are conserved, every strip centre projects onto the
centreline with lateral 0, and every strip lies inside `[0, arcLength]`. A 1 cm gap
mutation fails 8 of these assertions.

---

## 7. What was verified per the brief

- **Rendering** — asphalt emitted per span; footprint mask pixel-identical; seam proven
  exact; no gap, no overlap, no z-fight at the joint (both spans share one yaw, so they
  are coplanar halves, not two differently-angled planes).
- **Seams** — see §6.
- **Buildings** — world baseline zero drift, 845 buildings, digest `c60e15b5`.
- **POIs** — untouched; `pharmacy` on `asad_4` at fraction 0.62 resolves through the
  unchanged chord projection, and the gameplay baseline is unchanged.
- **Navigation** — Dijkstra (`findRoute`) untouched, costs still `seg.length` (the chord),
  so no route or race distance moved. Gameplay baseline zero drift.
- **Minimap** — now draws the polyline; for collinear vertices the three-point line is
  geometrically identical to the previous two-point line (test asserts collinearity to
  1e-9). 0 pixels differ by more than 10 %.
- **Traffic** — lane graph byte-identical, 140 lanes, digest `52306cb0`, `routes.ts`
  untouched. No lane split.
- **Races** — no retuning. Deadlines, course distances and shortcut savings all unchanged
  (gameplay baseline zero drift).

---

## 8. Reversibility

Removing `asad_4` from the `COLLINEAR_SUBDIVISIONS` table restores the previous build
bit-for-bit; the renderer and minimap then emit exactly one strip/segment again. The
table also throws at module load if it ever targets a segment that does not exist, or
lists fractions that do not start at 0 and end at 1.

No OSM alignment, junction coordinate, or other road geometry was modified. Only
`asad_4` carries vertices; the other 69 segments are untouched and their spans are
single chords.

---

## 9. Not done (deliberately)

- **P3 — real curved OSM geometry for `asad_4`.** Not started; requires a separate
  written proposal and explicit approval. Two prerequisites remain open from the design:
  the verified median vertices cannot be inserted while the junctions stay fixed (the road
  would fold back past its own endpoint), and a lane-id save/telemetry check is still
  unanswered.
- Migration of the 214 chord-arithmetic call sites to `offsetPoint`. The API exists and
  is proven equivalent on every segment, but migrating the call sites is separate work.
- Lane digest in the *gameplay* baseline (it now has its own file instead).
- Device performance measurement of the extra span geometry.
