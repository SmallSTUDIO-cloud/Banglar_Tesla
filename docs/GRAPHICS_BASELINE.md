# Graphics Baseline — Hybrid Asset Pipeline (v0.8.0)

Measured **before any graphics work**. This document is the reference point that every
later change must be compared against. Nothing in the renderer, world geometry, materials
or LOD has been modified yet.

- Harness (CI): `tests/e2e/bench-street.mjs`
- Harness (device): `src/core/perfBench.ts`, reachable at `<game-url>?bench=1`

---

## 1. Why the protocol looks like this

The task requires measuring **one representative street section**, then testing on
**actual mid-range Android hardware** before expanding. Two constraints shaped the design:

1. **The CI sandbox has no GPU.** It renders through SwiftShader (software rasterisation).
   Absolute FPS and frame time measured there are meaningless for a phone; on this machine
   the app runs at **0.8–2.2 fps**. Only *scene cost* transfers: draw calls, triangle
   counts, texture bytes, geometry count, shader program count, JS heap.
2. **Frame-count sampling, not wall-clock windows.** The first version of the harness
   sampled for a fixed 6 s window. At ~1 fps that yielded 5–13 frames, so p95/p99 were
   noise. The harness now samples a fixed **number of frames** (40 warmup, then 240
   measured, first 10 % discarded for shader compile and texture upload). At ~1 fps this
   takes minutes per preset; on a phone at 60 fps it takes seconds.

**Sampling stability:** three repeated runs per preset. The run-to-run spread of the p50
frame time is reported alongside every result so an unstable figure cannot be mistaken for
a real one.

## 2. The benchmarked section

**Asad Avenue / Town Hall Bazar** — chosen because it is the densest realistic case the
player actually meets: a two-lane commercial street with storefront frontage on both
sides, mixed traffic, pedestrian crowds and the Town Hall landmark at the far end.

| Parameter | Value |
|---|---|
| Landmark reference | Town Hall, `(64.93, 98.11)` |
| Static eye | `(52, 2.2, 100)` |
| Static target | `(83, 2.4, 104)` |
| Drive start | `(44, 105)`, yaw `atan2(0.96, −0.28)` |
| Renderer | 960×540, `devicePixelRatio` 1 |

Both harnesses use the **same** section, the same camera pose, the same phase
(`golden`/`sunny`) and the same warmup, so CI and device numbers are directly comparable
on the transferable metrics.

Two scenarios:

- **static** — fixed camera looking down the street. Isolates scene cost from simulation.
- **drive** — the camera travels the street, so geometry enters and leaves the frustum.
  This is the scenario that distance culling and LOD will actually change.

## 3. Baseline results (CI, SwiftShader, 960×540)

### Scene cost — the transferable numbers

| preset | scenario | draw calls | draw calls (max in run) | triangles |
|---|---|---|---|---|
| low | static | 66 | 68 | 409,286 |
| low | drive | 118 | 119 | 534,992 |
| balanced | static | 112 | 112 | 776,292 |
| balanced | drive | 162 | 163 | 959,558 |
| high | static | 120 | 120 | 881,034 |
| high | drive | 167 | 171 | 1,051,516 |

### Resources (static scenario)

| preset | GPU texture | unique textures | texture slots | geometries | shader programs | JS heap |
|---|---|---|---|---|---|---|
| low | 21.29 MB | 15 | 19 | 277 | 78 | 108.9 MB |
| balanced | 21.29 MB | 15 | 21 | 277 | 86 | 110.4 MB |
| high | 21.29 MB | 15 | 21 | 277 | 86 | 110.8 MB |

### Frame timing — **relative only, NOT transferable to a phone**

| preset | scenario | fps | mean | p50 | p95 | p99 |
|---|---|---|---|---|---|---|
| low | static | 1.8 | 559.3 | 445.4 | 1287.3 | 2420.4 |
| low | drive | 2.0 | 495.8 | 447.5 | 1288.6 | 1387.1 |
| balanced | static | 1.1 | 891.7 | 904.7 | 1886.5 | 1925.8 |
| balanced | drive | 0.9 | 1082.0 | 927.8 | 2473.3 | 2589.4 |
| high | static | 0.9 | 1116.9 | 1073.2 | 2344.9 | 2608.7 |
| high | drive | 0.8 | 1204.1 | 1132.8 | 2595.6 | 2661.1 |

*Run-to-run p50 spread over 3 runs: low 66.2 ms (14.9 %), balanced 34.6 ms (3.8 %),
high 182.3 ms (17.0 %). Software rasterisation is noisy, which is a second reason not to
treat these milliseconds as evidence about a phone.*

### What the baseline already tells us

- **Draw calls are low and scale gently.** 66 → 120 static, 118 → 167 driving. The existing
  merged-geometry path (`src/world/geo.ts:252 buildChunked`) plus instanced pedestrians and
  vehicles already batch well. Draw-call reduction is *not* the main win available.
- **Triangles are the dominant cost and they triple between low and balanced**
  (409 k → 776 k) before any new assets exist. `low` is the only preset with a real headroom
  reserve, and it is also the only preset without shadows.
- **Texture memory is flat and small at 21.29 MB / 15 unique textures** across every preset.
  Quality presets today do not touch texture resolution at all — the 20→30-cell `SignAtlas`
  added zero new textures. KTX2 and atlasing therefore have a clear, measurable budget to
  work inside rather than a problem to fix.
- **The static view is already fully loaded.** All 277 geometries and all texture bytes are
  resident regardless of preset or view direction. There is no distance-based geometry or
  texture residency at all: `drawDistance` (195/235/300) changes what is *drawn*, not what is
  *held*. Distance-based LOD has no existing system to extend — `THREE.LOD` appears nowhere
  in the codebase.

## 4. The hardware gate (blocking)

> The task states: *"Test on actual mid-range Android hardware before expanding."*

**This has not been done, and it cannot be done from this environment.** The CI machine's
"GPU" is `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)` —
a software rasteriser on a 2-core container. No figure from it is evidence about a phone.
**No Android performance claim is made in this document.**

To unblock, the measurement has to run on the real device. `src/core/perfBench.ts` exists
for exactly that:

1. Open the game on the phone.
2. Add `?bench=1` to the URL (append `&preset=balanced` to measure one preset only).
3. Wait. Three presets × 280 frames; roughly 15–45 s on a working phone.
4. The device report appears over the game: GPU name, vendor, core count, DPR, viewport,
   max texture size, then frame timing, scene cost and memory per preset.
5. **Copy results** and paste them back.

The panel is the only artefact needed to decide the gate. It reports the real GPU string, so
a run on an emulator or a desktop browser is self-evident and cannot be mistaken for a phone.

**Decision rule, fixed before any graphics work starts** (so the result cannot be
rationalised after the fact):

- `balanced` must hold **≥ 45 fps mean** and **≥ 30 fps p95** at the phone's native DPR on
  the benchmarked street. If it does not, the baseline is already too heavy and detail work
  must be *reduced* or moved behind LOD before anything is added.
- If `balanced` passes with margin, the margin is **not** a licence to raise detail globally.
  New detail is allowed only where the baseline is cheapest — i.e. it must be offset by LOD,
  culling or atlas work on the same screen, keeping the section's fps within noise of
  baseline.
- `low` must stay **≥ 30 fps mean**; it is the fallback for weaker hardware and must not
  regress.

## 5. State at the time of this baseline

Unchanged by this task: renderer setup (`ACESFilmicToneMapping`, exposure 1.02,
`PCFShadowMap`, fov 58, near 0.15, far 360), all world geometry, materials, textures and
gameplay. New in this commit, and nothing else:

| File | Change |
|---|---|
| `tests/e2e/bench-street.mjs` | CI baseline harness (new) |
| `src/core/perfBench.ts` | on-device harness (new, lazy-loaded chunk) |
| `src/game.ts` | `debugSetFreeCamera()` public setter (the only `src/` change to existing code) |
| `src/main.ts` | opt-in `?bench=1` hook after `start()` |
| `docs/GRAPHICS_BASELINE.md` | this document |

The `?bench=1` path is a dynamic `import()`, so it ships as a separate 2.60 kB gzip chunk
and is not downloaded on a normal boot. It never writes to saved settings: the player's
quality preset is captured before the run and restored afterwards.

## 6. Next steps (gated on §4)

Do not start these until the device numbers exist:

1. LOD tiers for the hero rickshaw and traffic, driven by distance, with crossfade.
2. Modular building/market kit with shared materials and a texture atlas.
3. Medium/low environment proxies for distant city fabric.
4. Frustum + distance culling pass with per-preset budgets wired into `QUALITY`.
5. GLB + Draco loading and KTX2 (only where the device reports support).

Every one of these lands as a *measured delta* against the tables in §3, measured with the
same harness on the same section, plus a new device run.
