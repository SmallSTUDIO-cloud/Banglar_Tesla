# Asad Avenue `asad_4` alignment experiment — measured, reverted

**Status: REVERTED.** No geometry change is in the tree. This document is the
evidence trail for the Step-1 densification attempt and why it was rolled back
under the standing rule *"if critical regressions appear, revert and document
the cause."*

| | |
|---|---|
| Branch | `arena/f78d620e-banglar-tesla` |
| Baseline | `a425f88` |
| Attempted edit | `src/world/mohammadpurData.ts` only (1 section, `asad_4`) |
| Outcome | Reverted to `a425f88`; suite green again |
| Post-revert health | typecheck clean · **396/396 in 45 files** · `GEOGRAPHY OK` · build 364.61 kB gzip |

Method: a purpose-built harness, `tools/snapshot-gameplay.ts`, dumps the full
gameplay graph, place markers, landmarks and all 17 race courses (17 courses /
14 shortcuts / 70 segments / 42 nodes / 14 places) to JSON, so every affected
reference is compared **before → after** rather than eyeballed.

```
npx vite-node tools/snapshot-gameplay.ts > .tmp-probe/before.json
# ...edit...
npx vite-node tools/snapshot-gameplay.ts > .tmp-probe/after.json
```

---

## 1. What was attempted

`asad_4` (`town_hall → asad_post`) was a single 79.12 m straight chord spanning
the one genuinely curved stretch of Asad Avenue. Per OSM way **565418929**
(আসাদ এভিনিউ, `secondary`, 21 vertices, 453.1 m), that span runs s=184.7 m →
s=260.5 m and bends at real vertex **v13** = `(96.54, 98.17)`, bow 4.66 m.

The edit:

- `town_hall` → `(46.45, 116.91)` (was `(42, 106)`) — true projection at s=184.7
- `asad_post` → `(118.8, 96.83)` (was `(118, 84)`) — true projection at s=260.5
- new node `asad_osm_13` = `(96.54, 98.17)` (OSM v13, unmodified)
- `asad_4` → `town_hall → asad_osm_13`; new `asad_4b` → `asad_osm_13 → asad_post`
  (both keep `width 12.2`, `sidewalk 2.8`, `kind main`, `osmWayId 565418929`,
  `jamProne`)

Segment IDs, widths, classes and names were preserved; `asad_4` was **split**,
not removed, so its ID survives for every existing reference
(`landmarks.ts:112`, `pharmacy` @ frac 0.62, the 15 m bazaar-marker rule, etc.).

### Geometric result — the edit was correct on its own terms

Max perpendicular residual between the real OSM polyline and each candidate
centreline, over the s=184.7–260.5 m span:

| Candidate | Max residual |
|---|---|
| **Current** (single chord `town_hall → asad_post`) | **12.54 m** |
| **Attempted** (re-anchor both ends + add v13) | **0.71 m** |
| Minimal variant (keep old junctions + add v13) | 11.43 m |

So the change bought a **17.7× accuracy improvement** (12.54 m → 0.71 m). It
fails elsewhere.

---

## 2. Why it was reverted — collateral damage to shared junctions

`town_hall` and `asad_post` are not private to `asad_4`; eight segments touch
those two terminals. Moving them re-aimed every one of those roads.

### Segment lengths (before → after)

| Segment | Before | After | Δ |
|---|---:|---:|---:|
| `asad_3` (`asad_salimullah→town_hall`) | 62.65 | 63.28 | **+0.63** |
| `asad_4` (`town_hall→asad_post`) | 79.12 | 53.48 | **−25.64** |
| `asad_4b` (new, `asad_osm_13→asad_post`) | — | 22.30 | new |
| `asad_5` (`asad_post→asad_iqbal`) | 78.03 | 78.61 | **+0.58** |
| `bazar_cut_se` | 91.30 | 103.07 | **+11.77** |
| `post_shahjahan` | 121.80 | 133.48 | **+11.68** |
| `shershah_1` | 92.35 | 104.10 | **+11.75** |
| `zakir_1` | 74.67 | 66.47 | **−8.20** |
| `zakir_3` | 86.83 | 74.73 | **−12.10** |

Nine segments changed. Five of them — the cross-streets — moved 8–12 m each in
length purely because their junction endpoint shifted.

### Place markers dragged along

| Place | Before | After | Moved |
|---|---|---|---:|
| `pharmacy` (segment-derived, `asad_4` t=0.62) | (87.3, 86.2) | (75.2, 99.3) | **17.8 m** |
| `bazaar` (landmark-anchored) | (67.4, 106.6) | (71.5, 115.7) | **10.0 m** |
| `zakir` | (110.7, 128.8) | (111.0, 135.1) | **6.3 m** |
| `garage` | (33.3, 62.3) | (35.6, 67.9) | **6.1 m** |

`bazaar` is landmark-anchored, so it should *not* have moved at all — it moved
because the anchor is projected onto a segment whose geometry changed.

### Race courses — 11 of 17 changed distance

| Course | Before | After | Δ |
|---|---:|---:|---:|
| `ev_street_asad` | 1091 | **1116** | **+25** |
| `bl_boss_01` | 2233 | 2254 | +21 |
| `bl_boss_05` | 979 | 998 | +19 |
| `bl_boss_10` | 591 | 572 | −19 |
| `bl_boss_06` | 791 | 803 | +12 |
| `bl_boss_09` | 387 | 399 | +12 |
| `ev_delivery_bazaar` | 574 | 586 | +12 |
| `ev_sprint_nurjahan` | 548 | 560 | +12 |
| `ev_duel_ring` | 765 | 762 | −3 |
| `ev_survival_jam` | 439 | 437 | −2 |
| `bl_boss_02` | 866 | 864 | −2 |

### Shortcuts — 3 of 14 lost value

| Shortcut | Before | After | Δ |
|---|---:|---:|---:|
| `sc_bazar_gali_10` | 13.0 | **3.0** | **−10.0** |
| `sc_gali_lalmatia` | 95.0 | 80.0 | −15.0 |
| `sc_lalmatia_05` | 95.0 | 80.0 | −15.0 |

`sc_bazar_gali_10` collapsing from a 13 m to a 3 m saving effectively deletes a
designed shortcut — it stops being worth taking.

---

## 3. Test outcome — 2 failures, both caused by this change

Baseline `a425f88` was green (396/396). After the edit:

```
FAIL tests/unit/landmarks.test.ts > market place markers
     > bazaar marker is anchored to its real OSM market within 15 m
FAIL tests/unit/vnext-race-timing.test.ts > race deadline calibration
     > gives every normal AI finisher breathing room before the authored deadline
  "ev_street_asad: limit 245s; AI 174.3/187.9/199.2s; minimum 250s"
  "ev_duel_ring:   limit 185s; AI  90.8/103/147.4s;  minimum 190s"
Test Files 2 failed | 43 passed (45)
     Tests 394 passed (396)
```

Confirmed causal by reverting the file and re-running those two files alone:
**32/32 passed**. Both failures are attributable to the edit, not pre-existing.

`ev_street_asad` is the serious one: the course grew +25 m, which pushes the
slowest AI finisher's required time to 250 s against an authored **245 s**
deadline. That is a race that can no longer guarantee the AI finishes in time.

Per the standing rule, deadlines and AI timings are **not** to be edited to make
this pass. That closes the door on shipping this change as-is.

---

## 4. Root cause — this is not a local digitising error

The residual at `asad_4` is a symptom. Measuring every Asad Avenue game node
against its nearest point on the real OSM way shows a nearly *constant* offset:

| Node | dx | dz | distance |
|---|---:|---:|---:|
| `bus_stand` | −9.8 | −12.5 | 15.9 |
| `asad_nurjahan` | −8.8 | −13.9 | 16.5 |
| `asad_salimullah` | −6.0 | −12.2 | 13.6 |
| `town_hall` | −4.5 | −10.9 | 11.8 |
| `asad_post` | −0.8 | −12.8 | 12.9 |
| `asad_iqbal` | −0.5 | −11.5 | 11.5 |
| `asad_gate_e` | −0.6 | −13.5 | 13.5 |

`dz` is −11.5 to −13.9 m, mean **−12.5 m**, spread only 3.0 m. In this
projection +z is south, so **the entire game Asad Avenue sits ~12.5 m north of
the real road**. `dx` spreads 9.3 m only because the game road is a coarse
polyline crossing a diagonal stretch.

This matches the disclaimer already shipped in `mohammadpurData.ts` (nodes are
hand-placed, straight-line approximation, ~34 % of real network length). The
corridor is a uniformly displaced hand-traced copy, not a badly digitised OSM
import.

**Consequence:** re-anchoring one junction cannot fix a corridor-wide
displacement. Any honest fix has to move the whole Asad Avenue corridor
together, and that necessarily re-times every race and re-prices every shortcut
on it. Both are authored gameplay decisions requiring approval, not silent
side-effects.

---

## 5. Incidental finding — Asad Avenue is a dual carriageway

While checking which OSM way to trust:

| Way | Name | Class | Oneway | Verts | Dist. to Town Hall Market centroid |
|---|---|---|---|---:|---:|
| **565418929** | আসাদ এভিনিউ / Asad Avenue | secondary | yes | 21 | 10.5 m |
| **223068915** | আসাদ এভিনিউ / Asad Avenue | secondary | yes | 19 | 13.5 m |
| 32561554 | Asad Avenue | residential | no | 8 | 194.1 m |
| 337839595 | Asad Avenue | living_street | no | 2 | 25.3 m |

Ways 565418929 and 223068915 are the two halves of a **dual carriageway**,
running parallel and only **2.0–3.4 m** apart along the entire Town Hall stretch.
The game graph models a single centreline at half width 6.1 m, so both
carriageways fall inside the drawn asphalt and the choice between them does not
affect the centreline meaningfully — but it is worth recording that Asad Avenue
is dual-carriageway and the current model collapses it to one centreline.

---

## 6. What is kept

- `tools/snapshot-gameplay.ts` — the before/after regression harness. This is
  the reusable part of the work and is committed.
- `.tmp-probe/` scratch dumps are deleted.
- **No** change to `mohammadpurData.ts`, gameplay, races, traffic or missions.

## 7. What was *not* done (disclosed)

- No "after" gameplay screenshots were captured: the change was reverted at the
  measurement gate, before the screenshot step. `artifacts/asad4-before-*.png`
  exist from the baseline run but are not evidence of any after-state.
- No production build or `bench-street.mjs` run against the modified tree
  (reverted first); both were validated at baseline only.
- FPS numbers were not produced for this experiment. SwiftShader software
  rendering is not device evidence and is not reported as such.

## 8. Recommended next step (needs approval)

The corridor-wide fix, in one coordinated change rather than per-segment:

1. Re-anchor **all seven** Asad Avenue nodes to their true OSM projections
   (removes the constant ~12.5 m northward bias).
2. Re-run `tools/snapshot-gameplay.ts` and accept the resulting distance deltas.
3. **Explicitly** re-author the affected race deadlines and shortcut definitions
   to match, with the diffs shown for review — not tuned to pass a test.
4. Re-verify all 17 courses, connectivity, clearance and collisions, then
   capture before/after screenshots.

Step 3 is a gameplay-design change and is why this needs sign-off before it is
attempted. A single-section edit cannot achieve accuracy while the surrounding
corridor remains displaced.
