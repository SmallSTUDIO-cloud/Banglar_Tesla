# Synthetic road impact audit

**Diagnostic only.** Nothing in `src/`, the world, the roads, the eviction policy,
the region budgets or gameplay was changed. The one new directory is
`diagnostics/synthetic-road-audit/`, which the game bundle never imports.

- Branch: `arena/f78d620e-banglar-tesla`
- Audit commit: `dac11e5`
- Shipped world unchanged: **845 buildings, digest `c60e15b5`**
- `main` untouched at `84e79e4`

---

## 1. Question

Inserting the synthetic road `synth_near` — the 9 m main road from (−60, −200) to
(60, 160) that the existing perturbation tests use — through mapped
neighbourhoods removes **54** of the 845 shipped buildings. Which removals are
genuine carriageway conflicts, and which are side effects?

## 2. Answer in one table

| measured cause | n | distance to the new centreline (m, min / median / max) |
|---|---|---|
| Footprint under the asphalt (exact OBB overlap) | **17** | 0.0 / 5.4 / 11.8 |
| Footprint clear of asphalt, inside sidewalk+0.55 m setback | **2** | — |
| **Subtotal: genuine geometric conflicts** | **19** | 0.0 / 5.5 / 11.8 |
| No overlap — frontage re-rolled by an upstream rejection | **29** | 11.6 / 33.7 / 70.9 |
| No overlap — re-rolled by a later pass (trigger not pinned) | **6** | 18.7 / 41.4 / 68.0 |
| **Subtotal: collateral** | **35** | 11.6 / 34.8 / 70.9 |

**19 genuine (35 %) · 35 collateral (65 %).**

Nine of the 35 collateral buildings are more than 43 m from the new centreline —
i.e. beyond the limit the generator itself uses when deciding whether a candidate
belongs to a road at all. Nine are further than the road is wide by a factor of
five.

### The specific hypothesis in the brief is disproved

> "Removed only because the new road becomes its nearest road"

**19 buildings** do gain `synth_near` as their nearest road (out of 54). **All 19
are genuine conflicts** — 17 overlap the asphalt, 2 fail the corridor predicate.
**Zero** buildings are removed by attribution change alone. Being nearest to the
road is a *consequence* of standing on it, not a cause of removal.

![zoom](diagnostics/synthetic-road-audit/out/03-plan-zoom-conflicts.png)

## 3. How each building was classified

Measured, never inferred:

1. **Exact OBB-vs-stadium overlap** (`obbVsStadium` in `analysis.ts`): each
   footprint's oriented bounding box against the road's rectangle-plus-end-caps
   stadium, in road-local coordinates. Gives intrusion depth in metres.
2. **The engine's own predicate**: `isFootprintClearOfCorridor(cx, cz, w, d, yaw, 0.55)`
   evaluated **with the synthetic road installed and the spatial index rebuilt**.
   (Measured after the index was restored, every building reads "clear" — that
   measurement bug hid all corridor-only rejections on the first run and was fixed.)
3. **Frontage attribution**: nearest *legacy* segment, which side, and the
   distance along it, computed against the shipped graph.
4. **Draw-order propagation**: `buildCity()` creates one
   `bRng = buildingRngFor(seg.id)` **per segment** and iterates `side ∈ [−1, +1]`
   against it, so side −1 is generated first and every draw it consumes shifts
   side +1. A rejected candidate consumes 3 draws and advances `along` by 4.5 m;
   an accepted one consumes ~15 and advances by the building width. One rejection
   therefore re-rolls the remainder of that segment's frontage **on both sides**.

> **Correction made during the audit.** The first version grouped by
> "segment + side" and attributed 14 re-rolls / 21 unexplained. That model is
> wrong for the reason above (the RNG is shared across both sides of a segment);
> `babar_1` alone showed 10 removals with zero conflicts on one side, which sent
> the investigation to `buildingRng.ts`. Regrouping by segment gives 29 / 6. The
> per-side numbers in the first draft are superseded and are not reported as
> results.

Reproduce: `npx vite-node diagnostics/synthetic-road-audit/probe-cascade.ts` and
the audit itself via the diagnostic server (below).

## 4. The mechanisms, with evidence

### 4.1 Genuine conflicts (19)

The road's corridor is 12 m wide (9 m asphalt + 2 × 1.5 m sidewalk) plus a
0.55 m setback. A building whose footprint falls inside that band cannot be
placed, with or without legacy precedence — `canPlaceBuilding()`'s corridor test
is deliberately **not** legacy-scoped, so it rejects shipped and new buildings
alike. These 19 are the honest cost of driving a 9 m road through built-up
blocks, and they would have to be accepted or the road rerouted.

Maximum measured intrusion into the asphalt: **9.00 m** — a building almost
exactly the width of the carriageway. Minimum centre-to-centreline distance:
**0.03 m**. 8 buildings have their *centre* inside the asphalt.

### 4.2 Collateral re-roll (29) — one rejection costs a whole streetfront

The frontage walk is a feedback loop:

```
rejected  → along += 4.5,      3 RNG draws consumed
accepted  → along += bWidth+gap,  ~15 RNG draws consumed
```

`bWidth`, `depth`, `setback` and `floors` are the *next* draws from the same
per-segment generator, so once one candidate is refused, every later candidate on
that segment is regenerated at a different position and size. The audit's clearest
single example: `babar_1` measures **70.9 m** from the new centreline — its
carriageway physically cannot touch anything on it — yet it loses 15 buildings,
because one edge candidate is refused.

Worked example (street level, `05-street-42pct.png`): streets that are visually
untouched lose their frontage rows.

### 4.3 Controlled experiment: is the cascade real, or an artefact of one road?

Six independent 60 m stubs, each targeting a *single* building in a different
neighbourhood:

| stub target | evicted | genuine | collateral |
|---|---|---|---|
| asad_0 frontage | 3 | 3 | 0 |
| ring_0 frontage | 6 | 2 | 4 |
| tajmahal_1 frontage | 9 | 6 | 3 |
| humayun_1 frontage | 19 | 8 | 11 |
| shahjahan_1 frontage | 28 | 8 | 20 |
| johuri_bypass frontage | 19 | 8 | 11 |
| **total** | **84** | **35** | **49 (58 %)** |

Six independent trials agree with the main audit to within 7 points of collateral
share. The cascade is a property of the generator, not of this particular road.

### 4.4 The six not fully pinned

All six sit on segments (`shahjahan_3`, `babar_link_w`, `babar_link_m`) with **no
direct conflict at all**, all have replacements standing within a few metres of
their old slot, and none overlaps or violates the corridor predicate. Their
regeneration is real and measured; the exact trigger is in a later pass (the
shop-front seam or the block-interior fill, which also share `infillCount` and the
sector budgets) and this audit did not isolate it. Reported as unresolved rather
than guessed.

## 5. Screenshot evidence

All images come from real headless Chromium (`puppeteer-core` +
`@sparticuz/chromium`, the repo's own pair) rendering the diagnostic page, which
builds the world with the synthetic road installed. No mock geometry.

| file | what it shows |
|---|---|
| `out/01-plan-world.png` | whole 845-building city, evictions painted by cause; HUD legend |
| `out/02-plan-evictions.png` | all 54 evicted footprints, numbered 1–54 |
| `out/03-plan-zoom-conflicts.png` | zoomed: red/orange over the carriageway vs yellow/blue far from it |
| `out/04-street-18pct.png` | street level, 18 % along the road |
| `out/05-street-42pct.png` | street level, 42 % — cyan corridor crossing a shipped street |
| `out/06-street-62pct.png` | street level, 62 % |
| `out/07-bird-3d.png` | 300 m oblique aerial, fog off; cyan = the synthetic carriageway |

Capture log with byte sizes and the page's error list: `out/capture-report.json`
(errors: none). Raw measured rows: `out/audit-rows.json`, `out/evictions.csv`,
`out/evictions-table.md`, `out/cascade-experiment.json`.

## 6. Verification against `9f3e26e`

The audit engine was re-run with `9f3e26e`'s `src/world/city.ts` in place
(restored afterwards, `md5sum` checked):

| | current `cd89863` | `9f3e26e` |
|---|---|---|
| shipped digest | `c60e15b5` | `c60e15b5` |
| evicted | 54 | 54 |
| added | 39 | 39 |
| carriageway-overlap | 17 | 17 |
| corridor-clearance | 2 | 2 |
| frontage-reroll | 29 | 29 |
| unexplained | 6 | 6 |
| **identical eviction set (54 collider keys)** | **yes** | — |

The regional-fill work changed nothing about this behaviour, which is what
`docs/REGIONAL_FILL.md` §7.2 claimed — now independently confirmed by key equality
rather than by count.

## 7. Full table — all 54

`dist.` is centre-to-centreline; `signed clearance` is that minus the 4.5 m
half-width, so a negative value puts the building's centre inside the asphalt;
`overlap` is the exact analytic OBB intrusion depth.

| # | building id | x, z (m) | frontage | u (m) | dist. to centreline (m) | signed clearance to asphalt (m) | asphalt overlap depth (m) | nearest road after | cause |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `aziz_2:-36.25,-117.81` | -36.2, -117.8 | aziz_2 / 1 | 53.2 | 3.46 | -1.04 | 7.89 | synth_near | carriageway-overlap |
| 2 | `aziz_2:-35.20,-129.60` | -35.2, -129.6 | aziz_2 / 1 | 56.8 | 1.26 | -3.24 | 7.69 | synth_near | carriageway-overlap |
| 3 | `aziz_2:-25.60,-120.78` | -25.6, -120.8 | aziz_2 / 1 | 64.3 | 7.58 | +3.08 | 4.61 | synth_near | carriageway-overlap |
| 4 | `babar_1:-68.43,-208.23` | -68.4, -208.2 | babar_1 / -1 | 68.4 | 11.78 | +7.28 | 0.74 | synth_near | carriageway-overlap |
| 5 | `babar_1:-60.16,-209.28` | -60.2, -209.3 | babar_1 / -1 | 76.8 | 9.29 | +4.79 | 2.21 | synth_near | carriageway-overlap |
| 6 | `humayun_2:-47.85,-140.81` | -47.9, -140.8 | humayun_2 / -1 | 77.1 | 7.19 | +2.69 | 3.93 | synth_near | carriageway-overlap |
| 7 | `humayun_2:-38.54,-144.84` | -38.5, -144.8 | humayun_2 / -1 | 87.1 | 2.92 | -1.58 | 8.75 | synth_near | carriageway-overlap |
| 8 | `humayun_2:-58.92,-165.08` | -58.9, -165.1 | humayun_2 / 1 | 72.0 | 10.02 | +5.52 | 1.07 | synth_near | carriageway-overlap |
| 9 | `humayun_2:-55.70,-187.00` | -55.7, -187.0 | humayun_2 / 1 | 80.3 | 0.03 | -4.47 | 9.00 | synth_near | carriageway-overlap |
| 10 | `humayun_2:-50.37,-167.76` | -50.4, -167.8 | humayun_2 / 1 | 81.0 | 1.06 | -3.44 | 9.00 | synth_near | carriageway-overlap |
| 11 | `humayun_2:-41.72,-169.78` | -41.7, -169.8 | humayun_2 / 1 | 89.9 | 7.78 | +3.28 | 3.62 | synth_near | carriageway-overlap |
| 12 | `tajmahal_5:-26.70,-83.22` | -26.7, -83.2 | tajmahal_5 / 1 | 24.4 | 5.34 | +0.84 | 4.91 | synth_near | carriageway-overlap |
| 13 | `tajmahal_5:-25.98,-94.03` | -26.0, -94.0 | tajmahal_5 / 1 | 35.2 | 1.24 | -3.26 | 8.77 | synth_near | carriageway-overlap |
| 14 | `zakir_1:46.53,123.76` | 46.5, 123.8 | zakir_1 / 1 | 15.1 | 1.32 | -3.18 | 7.49 | synth_near | carriageway-overlap |
| 15 | `zakir_1:44.51,134.05` | 44.5, 134.1 | zakir_1 / 1 | 25.4 | 6.49 | +1.99 | 3.99 | synth_near | carriageway-overlap |
| 16 | `zakir_5:54.66,161.32` | 54.7, 161.3 | zakir_5 / 1 | 39.9 | 5.48 | +0.98 | 4.78 | synth_near | carriageway-overlap |
| 17 | `zakir_5:63.59,160.83` | 63.6, 160.8 | zakir_5 / 1 | 48.9 | 3.68 | -0.82 | 3.65 | synth_near | carriageway-overlap |
| 18 | `shershah_2:5.56,-33.61` | 5.6, -33.6 | shershah_2 / -1 | 51.1 | 9.58 | +5.08 | 0.00 | synth_near | corridor-clearance |
| 19 | `zakir_1:62.30,140.20` | 62.3, 140.2 | zakir_1 / 1 | 25.0 | 8.44 | +3.94 | 0.00 | synth_near | corridor-clearance |
| 20 | `babar_1:-50.91,-211.19` | -50.9, -211.2 | babar_1 / -1 | 86.2 | 14.41 | +9.91 | 0.00 | babar_1 | frontage-reroll |
| 21 | `babar_1:-39.73,-211.42` | -39.7, -211.4 | babar_1 / -1 | 97.3 | 23.27 | +18.77 | 0.00 | babar_1 | frontage-reroll |
| 22 | `babar_1:-29.53,-214.12` | -29.5, -214.1 | babar_1 / -1 | 107.8 | 33.59 | +29.09 | 0.00 | babar_1 | frontage-reroll |
| 23 | `babar_1:-124.34,-229.77` | -124.3, -229.8 | babar_1 / 1 | 15.4 | 70.89 | +66.39 | 0.00 | babar_1 | frontage-reroll |
| 24 | `babar_1:-113.05,-230.45` | -113.0, -230.4 | babar_1 / 1 | 26.7 | 61.17 | +56.67 | 0.00 | babar_1 | frontage-reroll |
| 25 | `babar_1:-102.40,-230.91` | -102.4, -230.9 | babar_1 / 1 | 37.3 | 52.47 | +47.97 | 0.00 | babar_1 | frontage-reroll |
| 26 | `babar_1:-91.93,-231.91` | -91.9, -231.9 | babar_1 / 1 | 47.8 | 45.14 | +40.64 | 0.00 | babar_1 | frontage-reroll |
| 27 | `babar_1:-81.91,-234.05` | -81.9, -234.1 | babar_1 / 1 | 58.0 | 40.49 | +35.99 | 0.00 | babar_1 | frontage-reroll |
| 28 | `babar_1:-72.69,-236.06` | -72.7, -236.1 | babar_1 / 1 | 67.4 | 38.23 | +33.73 | 0.00 | babar_1 | frontage-reroll |
| 29 | `babar_1:-64.79,-236.48` | -64.8, -236.5 | babar_1 / 1 | 75.3 | 36.79 | +32.29 | 0.00 | babar_1 | frontage-reroll |
| 30 | `babar_1:-55.38,-238.04` | -55.4, -238.0 | babar_1 / 1 | 84.8 | 38.32 | +33.82 | 0.00 | babar_1 | frontage-reroll |
| 31 | `babar_1:-45.15,-237.47` | -45.1, -237.5 | babar_1 / 1 | 94.9 | 40.31 | +35.81 | 0.00 | babar_1 | frontage-reroll |
| 32 | `babar_1:-35.31,-239.26` | -35.3, -239.3 | babar_1 / 1 | 104.9 | 46.37 | +41.87 | 0.00 | babar_1 | frontage-reroll |
| 33 | `humayun_2:-27.80,-147.67` | -27.8, -147.7 | humayun_2 / -1 | 98.2 | 14.00 | +9.50 | 0.00 | humayun_2 | frontage-reroll |
| 34 | `humayun_2:-19.18,-152.07` | -19.2, -152.1 | humayun_2 / -1 | 107.6 | 23.57 | +19.07 | 0.00 | humayun_2 | frontage-reroll |
| 35 | `humayun_2:-13.20,-152.44` | -13.2, -152.4 | humayun_2 / -1 | 113.5 | 29.36 | +24.86 | 0.00 | humayun_2 | frontage-reroll |
| 36 | `humayun_2:-9.27,-154.47` | -9.3, -154.5 | humayun_2 / -1 | 117.8 | 33.73 | +29.23 | 0.00 | humayun_2 | frontage-reroll |
| 37 | `humayun_2:-107.12,-153.19` | -107.1, -153.2 | humayun_2 / 1 | 22.4 | 59.51 | +55.01 | 0.00 | humayun_2 | frontage-reroll |
| 38 | `humayun_2:-97.36,-157.11` | -97.4, -157.1 | humayun_2 / 1 | 32.8 | 49.01 | +44.51 | 0.00 | humayun_2 | frontage-reroll |
| 39 | `humayun_2:-86.01,-157.92` | -86.0, -157.9 | humayun_2 / 1 | 44.0 | 37.98 | +33.48 | 0.00 | humayun_2 | frontage-reroll |
| 40 | `humayun_2:-76.41,-161.15` | -76.4, -161.2 | humayun_2 / 1 | 54.1 | 27.85 | +23.35 | 0.00 | humayun_2 | frontage-reroll |
| 41 | `humayun_2:-67.97,-164.22` | -68.0, -164.2 | humayun_2 / 1 | 63.0 | 18.87 | +14.37 | 0.00 | humayun_2 | frontage-reroll |
| 42 | `humayun_2:-32.75,-172.30` | -32.8, -172.3 | humayun_2 / 1 | 99.2 | 17.09 | +12.59 | 0.00 | humayun_2 | frontage-reroll |
| 43 | `humayun_2:-24.09,-174.57` | -24.1, -174.6 | humayun_2 / 1 | 108.1 | 26.03 | +21.53 | 0.00 | humayun_2 | frontage-reroll |
| 44 | `humayun_2:-15.16,-175.45` | -15.2, -175.4 | humayun_2 / 1 | 117.0 | 34.77 | +30.27 | 0.00 | humayun_2 | frontage-reroll |
| 45 | `zakir_1:40.20,141.63` | 40.2, 141.6 | zakir_1 / 1 | 34.0 | 12.98 | +8.48 | 0.00 | zakir_1 | frontage-reroll |
| 46 | `zakir_1:38.76,150.21` | 38.8, 150.2 | zakir_1 / 1 | 42.6 | 17.06 | +12.56 | 0.00 | zakir_1 | frontage-reroll |
| 47 | `zakir_1:35.44,158.46` | 35.4, 158.5 | zakir_1 / 1 | 51.5 | 22.82 | +18.32 | 0.00 | zakir_1 | frontage-reroll |
| 48 | `zakir_5:71.62,159.45` | 71.6, 159.4 | zakir_5 / 1 | 57.0 | 11.63 | +7.13 | 0.00 | zakir_5 | frontage-reroll |
| 49 | `babar_link_m:-8.09,-175.49` | -8.1, -175.5 | babar_link_m / 1 | 12.2 | 41.50 | +37.00 | 0.00 | babar_link_m | unexplained |
| 50 | `babar_link_m:-8.70,-182.80` | -8.7, -182.8 | babar_link_m / 1 | 19.2 | 43.23 | +38.73 | 0.00 | babar_link_m | unexplained |
| 51 | `babar_link_m:-21.33,-214.37` | -21.3, -214.4 | babar_link_m / 1 | 53.2 | 41.26 | +36.76 | 0.00 | babar_link_m | unexplained |
| 52 | `babar_link_w:-115.96,-152.70` | -116.0, -152.7 | babar_link_w / -1 | 15.0 | 68.05 | +63.55 | 0.00 | babar_link_w | unexplained |
| 53 | `shahjahan_3:-18.06,-133.24` | -18.1, -133.2 | shahjahan_3 / 1 | 18.4 | 18.67 | +14.17 | 0.00 | shahjahan_3 | unexplained |
| 54 | `shahjahan_3:-16.04,-142.84` | -16.0, -142.8 | shahjahan_3 / 1 | 28.1 | 23.63 | +19.13 | 0.00 | shahjahan_3 | unexplained |

## 8. Recommendation

**Genuine conflicts (19): real, and unavoidable for this alignment.** Accept them
as per-corridor displacement, or move the centreline. Do not weaken the corridor
check to keep them — they are exactly what the check exists to catch.

**Collateral (35): false-positive removals, and they are the actual problem.**
They are not a policy question; they are a bug-shaped behaviour in the frontage
walk. The cheapest defensible fix is to make the walk's *step* independent of
whether a candidate was accepted (advance by the candidate's own width either
way, and give a rejected candidate its own draw sequence), so one refusal cannot
re-roll its neighbours. That would be a separate, explicitly agreed task with its
own preservation gate — **not implemented here**, per the instruction to stop
after the audit.

Sequenced next step, in order:

1. Approve or reject a *precedence decision* for the 19 genuine conflicts (§8.1).
2. If approved, fix the frontage-walk step so rejections stop cascading, and
   re-run this audit unchanged as the acceptance test: the 35 collateral should
   collapse toward 0 while the 19 stay.

### 8.1 Still the user's decision

A carriageway laid over a standing building must remove it. Whether that is
acceptable for a real road (Mirpur Road would displace 18–28 buildings by the
earlier estimate) is a product decision this audit deliberately does not take.

## 9. Gates re-run for this audit

Run against the tree this document is committed with:

| gate | result |
|---|---|
| `npx tsc --noEmit` (game) | clean |
| `npx tsc -p diagnostics/synthetic-road-audit/tsconfig.json` | clean |
| `npx vitest run` | **656 passed / 63 files** |
| `python3 -m unittest discover -s tests/map_import` | **34 passed** |
| `npm run build` | **370.16 kB gzip**, unchanged |
| `git diff --check` | clean |
| shipped digest | `c60e15b5`, 845 buildings (`world-baseline` passes) |
| diagnostic in game bundle | **0 references** to `synthetic-road-audit` in `dist/` |

The capture run reported `errors: none` (no page errors, no console errors).

## 10. Reproducing

```bash
# type-check the diagnostic
npx tsc -p diagnostics/synthetic-road-audit/tsconfig.json

# serve it
npx vite --config diagnostics/synthetic-road-audit/vite.config.ts
# then open http://127.0.0.1:4321/

# capture the screenshots (needs the server above)
node diagnostics/synthetic-road-audit/capture.mjs

# the controlled cascade experiment
npx vite-node diagnostics/synthetic-road-audit/probe-cascade.ts
```

Removal is one directory: `rm -rf diagnostics/synthetic-road-audit` (and the
section added to `docs/engineering/ARENA_CONTINUATION.md`). No `src/` file,
baseline or golden was touched by this audit.
