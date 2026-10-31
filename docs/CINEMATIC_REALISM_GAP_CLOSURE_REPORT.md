# Cinematic realism gap-closure — evidence report

## Outcome and limits

**Partial visual milestone, not AAA or release signoff.** A formerly canopy-obscured road assessment is now a real, unobstructed, test-only camera capture. The eight authored potholes remain; their outer lips now read as lighter, segmented concrete rather than nearly black asphalt. A small cool, night-only emissive term on the existing asphalt material makes dark roads discernible in controlled night and rainy-night frames without new lights, geometry or draw passes. The road still looks stylized, night illumination is sparse, and no physical Android device or GPU was tested.

The exact task evidence is indexed in [`artifacts/cinematic-gap-closure-manifest.json`](../artifacts/cinematic-gap-closure-manifest.json). All 37 before and 37 after screenshots are under `artifacts/cinematic-gap-closure/`; each side has `metrics.json` and copies under `metrics/`. This is **not** a reuse of `CINEMATIC_REALISM_VISUAL_PASS_REPORT.md`.

### Protected starting state and provenance

Branch `arena/1cbc19eb-banglar-tesla`; starting HEAD `2dc02d776b2cdb520f53471f08fcb51e6fdf251e`; **0 staged, 34 modified tracked, 44 untracked paths** before this task. These existing changes are protected and not attributed to this pass. No reset, clean, branch switch, commit, push, PR or unrelated discard was performed. The only retained production edits from this pass are two narrow changes in `src/world/city.ts`; the large pre-existing diff in that file is **not** this task's work. No vehicle material experiment was retained.

At first, the before build and all 37 captures were run prior to those edits. Ignored `artifacts/` disappeared across an execution continuation; the evidence was **not** silently treated as present. A separate `/tmp/bt-cinematic-gap-baseline` copy of the current source was made and only the two task edits reversed there. The isolated source diff was checked, that copy was built, and all 37 before scenes were recaptured successfully. The project was independently rebuilt and all 37 after scenes recaptured, including the fixture assertions, with zero diagnostics on each capture. This reconstructed baseline is valid for the two specified changes, but is not a pristine historic Git revision. Neither the scratch project nor its build altered the dirty checkout.

### Skills and environment

Relevant installed skills were searched before editing: Console/DevTools, Three.js, WebGL profiling, PBR/materials, environment art, mobile optimization and automated visual testing. No relevant installed skill instruction files were found, so **no Console skill was used or installed**. The project Puppeteer/Chromium harness captured console, page, request, HTTP and WebGL diagnostics instead. The project rendering/test source and its historical graphics guidance were used as context; a public skill-discovery guide was read to check provenance, not installed as a skill.

Node **v22.22.3**, npm **10.9.8**, Chromium **153.0.8010.0** headless on ANGLE/Vulkan **SwiftShader (software)**, 960×540 at DPR 1 for the matrix. Renderer: sRGB output, tone mapping 4, exposure 1.04; fixture: city seed `mulberry32(20261207)`, pedestrians hidden, ambient traffic hidden and frozen, one controlled NPC where applicable. Default Balanced, sunny noon; per-scene hour/weather/preset/eye/look/FOV, renderer counts, `glError`, rain/night and fixture conditions are in the manifest and JSON. The test-only free camera removes the player from road-only scenes. It did not move the gameplay camera or introduce a fake plane. Camera-mode scenes use the actual supported game cameras; after captures enable the HUD to exercise cockpit mirrors, while before captures hide it, so **those seven camera PNG pairs are not pixel-matched**. Runtime frame/render-wall times in this report are noisy software measurements, not real GPU or Android FPS.

### Visual audit and corrections

- Road close-up: [`before/road-pothole-day.png`](../artifacts/cinematic-gap-closure/before/road-pothole-day.png) → [`after/road-pothole-day.png`](../artifacts/cinematic-gap-closure/after/road-pothole-day.png). The pothole and adjacent marking/curb/drain are unobstructed. The previous asphalt-colored lip disappeared into the asphalt; changed only the lip bucket to the existing concrete/sidewalk material with warm tint `#9b9184`. The dark recessed center, eight authored depths (0.065 m), road geometry and physics registration remain.
- Street day and wet: `road-street-day.png`, `road-pothole-wet.png`, and `commercial-rain.png`; markings, repairs, drains, kerbs and wet patches are visible in the respective frames, but not uniformly legible at every distance/weather. Rain is not proof of a photoreal wet road.
- Night: [`before/road-street-night.png`](../artifacts/cinematic-gap-closure/before/road-street-night.png) → [`after/road-street-night.png`](../artifacts/cinematic-gap-closure/after/road-street-night.png); also `road-street-rain-night.png` and `commercial-storm-night.png`. The former asphalt was almost black between lamps; the night factor now supplies `(0.012, 0.016, 0.022)` emissive RGB at full night and zero at noon. Wet/night contrast improves slightly, but black sky, sparse lamps and dark distant landmarks remain.
- Day, dusk, night, rain, storm and sunny-after-rain were inspected in the commercial fixture; DRMC and residential compositions were reviewed. The clear-after-rain frame checks a configured clear scene, **not** a proven live weather transition.
- Hero close and gameplay-distance frames, all eight NPC classes and the seven gameplay cameras were inspected. Vehicle material experiments had no demonstrable visual win and were reverted. NPCs remain stylized. Performance, Balanced and High are captured at the same street/weather/time/camera, not three different scenes.

### Matched renderer/resource comparison

Values are **before → after**. Rendered callbacks are the fixture's visible renderables, not a whole-world mesh census. Geometries/textures/programs are renderer memory/program statistics at the specified scene; program counts vary by scene/shader warmup. See JSON for all 37 rows.

| Scene | Draw calls | Triangles | Rendered callbacks | Geometries / textures / programs |
|---|---:|---:|---:|---:|
| Pothole day | 86 → 86 | 456,488 → 456,488 | 80 → 80 | 279 / 19 / 76 → same |
| Road night | 131 → 131 | 567,089 → 567,089 | 125 → 125 | 279 / 19 / 79 → same |
| Road rain-night | 135 → 135 | 567,473 → 567,473 | 129 → 129 | 279 / 19 / 79 → same |
| Commercial Performance | 119 → 119 | 363,647 → 363,647 | 121 → 121 | 279 / 17 / 93 → same |
| Commercial Balanced | 127 → 127 | 451,275 → 451,275 | 121 → 121 | 279 / 19 / 93 → same |
| Commercial High | 128 → 128 | 451,323 → 451,323 | 121 → 121 | 279 / 19 / 93 → same |

Other scenes can show small triangle variation (e.g. hero-close 513,785 → 513,689) without a changed draw-call/renderable count because transient scene/camera state is not pixel-deterministic. Do not interpret identical counts as a measured speedup. Fixture render-wall medians fluctuate (road pothole 1.3 → 3.8 ms, road night 0.9 → 0.8 ms, commercial Balanced 2.0 → 2.7 ms), with software-rendered variance; neither direction establishes a real GPU regression or improvement. Cost of retained edits: no new mesh, material bucket, draw pass or shadow caster; emissive updates existing asphalt uniforms.

### Culling, diagnostics and stability

`artifacts/cinematic-gap-closure/lod/results.json` records **26 samples each** of rickshaw, car, bus, truck, van, CNG, easybike and motorbike through near → medium → far → medium → near. Five representative PNGs per class are also indexed by the manifest. This is an actual transition sweep, not just a pair of static scene screenshots. `metrics/visibility-audit.json` separately exercises frustum front/behind/front (175/52/175 calls), 12 scene cycles with stable 279 geometries/19 textures and 67 warmed programs, eight preset/weather conditions, and cockpit mirror renders 2 vs chase 0. The audit's native mesh visibility, layer inventory and exception list are in its JSON. Distance-limited traffic, near/far detail layers, chunk visibility and frustum culling are separate mechanisms; none is an occlusion-culling claim. Coverage of distance and chunk behavior also rests on existing graphics/visibility regressions; no new proof of perfect terrain visibility in every orientation.

`metrics/console-after.json`: **23 staged transitions**, 0 captured console/page/request/HTTP events and 0 WebGL errors in those stages. Both 37-scene fixture runs also logged 0 diagnostics. This staged harness is not an exhaustive survey of all interactive states. Browser stress `metrics/stress.json`: **9/9 completed checks** (8 scenarios plus zero page errors), including eight road-rage cycles, 20 breakables, 30 boost toggles, 28 camera switches, six full scene cycles, ten visibility/audio cycles and a **54,000-fixed-step / 15 simulated minute** interleaved upgrade session. It ran in approximately 226 seconds of wall time for this invocation, **not** 15 minutes of continuous real-time driving; no 5–10-minute continuous gameplay run or device frame-cadence benchmark was completed. Sim-step average in the final session was 0.471 ms; warmed scene cycles ended at 305 geometries/22 textures and heap 12.31 → 13.25 MB (+0.94 MB). A previous SwiftShader run included a 1605.07 ms render spike; do not claim smooth real-device FPS or sustained stability from these tests.

### Regression and gameplay boundary

Production build/typecheck passed. Completed suites in this pass: **34 unit files / 222 tests, 21 browser E2E, 13 mobile-browser, 33 UI**; graphics/browser checks, vehicle contact matrix and visibility audit also passed. Live DRMC representative free-roam drive completed without browser errors. Live race traversed all four checkpoints in **94.3 s**, within its 115 s deadline, with one recovery and no browser errors, but **lost** (rival: 68.7 s). Thus race *completion* was exercised, not a race win. No test timeout or skipped suite is counted as passed here. Existing test files cover traffic/junctions, vehicle/driver rigs, contact, race, potholes, weather, mirrors, culling/chunks and save/upgrade; this visual pass did not rewrite NPC AI or gameplay logic. Pre-existing dirty work in these subsystems remains untouched by this task.

Android preflight `python3 scripts/build-apk.py --check` reported `ANDROID_HOME` unset; Android SDK not configured, Java and adb absent. **No APK was built; no installation, physical device test or Android GPU profile occurred.** Package `com.shostalab.banglartesla`, minSdk 24 and version 7 / `0.6.0` remain unchanged.

### Acceptance answers (§16)

1. **YES:** unobstructed `after/road-pothole-day.png` and `after/road-street-day.png`.
2. **PARTIAL:** road markings, asphalt, repairs, drains, curbs and pothole visible in `road-pothole-day`, `road-street-day`, `road-pothole-wet`; still stylized/variable visibility.
3. **YES:** `before/road-street-night.png` vs `after/road-street-night.png`.
4. **YES:** `road-street-rain-night.png`, `road-pothole-wet.png`, `commercial-rain.png`, `commercial-storm-night.png` (both sides).
5. **YES:** clear `commercial-balanced`, dusk `commercial-dusk`, night `commercial-night`, rain `commercial-rain`, storm `commercial-storm-night`, sunny-after-rain `commercial-clear-after-rain`.
6. **YES:** `hero-close.png`, `hero-gameplay.png` (each side).
7. **YES:** `after/npc-car.png`, `npc-bus.png`, `npc-truck.png`, `npc-van.png`, `npc-cng.png`, `npc-easybike.png`, `npc-motorbike.png`, `npc-rickshaw.png` (with corresponding before images).
8. **YES:** matched `commercial-performance`, `commercial-balanced`, `commercial-high`.
9. **YES:** `camera-chase`, `camera-close`, `camera-wide`, `camera-low`, `camera-front`, `camera-cockpit`, `camera-side` (note HUD mismatch between sides).
10. **YES:** all eight classes in `lod/results.json`, 26 samples each, near → medium → far → medium → near.
11. **YES, bounded:** frustum, distance, LOD and chunk visibility covered separately by `metrics/visibility-audit.json`, LOD results and existing visibility regressions; no hardware occlusion-culling claim.
12. **YES:** Puppeteer fallback, **not** an installed Console skill; 23-stage diagnostics at `metrics/console-after.json`.
13. **0** captured console/page/request/HTTP issues and **0** WebGL errors in that staged run; 0 diagnostics in matched fixture runs. Outside the tested states not established.
14. See six-row comparison above: these anchor scenes have **0 change** in draw calls, triangles, rendered callbacks, geometries, textures and programs. Scene-specific minor variations and noisy software wall time are disclosed above.
15. **YES, simulated only:** 9/9 stress checks; 54,000 fixed steps = 15 simulated minutes, ~226 seconds real wall time in the latest invocation. A continuous 5–10 minute live drive remains untested.
16. **YES for completed listed suites:** build/typecheck, 222 unit tests/34 files, 21 E2E, 13 mobile, 33 UI and listed focused checks; no timeout/skip counted. Live race was a loss, not a win.
17. **NO**, no physical Android test.
18. **NO**, no APK.
19. **NO** task changes to gameplay, physics, traffic or race; only road material bucket and night asphalt emissive term. Existing dirty changes are not this task.
20. **NO**, no pre-existing file/change was discarded.

### Final Git state and task files

Final branch `arena/1cbc19eb-banglar-tesla`, HEAD `2dc02d776b2cdb520f53471f08fcb51e6fdf251e` (unchanged); **0 staged, 34 modified tracked, 49 untracked paths**. The five additional untracked paths are the three new task E2E fixtures and the two documentation files. Task source changes: `src/world/city.ts`; new `tests/e2e/cinematic-gap.mjs`, `tests/e2e/cinematic-gap-lod.mjs`, `tests/e2e/cinematic-gap-console.mjs`, this report, `docs/CINEMATIC_REALISM_GAP_CLOSURE_REQUIREMENTS.md`, and the ignored task-specific artifacts/manifest. Ignored artifacts are local evidence, not staged, committed or guaranteed to survive an environment reset; keep a copy before clearing the workspace. No historical report or screenshot was overwritten.
