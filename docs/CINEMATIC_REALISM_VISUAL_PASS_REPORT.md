# Cinematic Realism & Visual Attention Pass — bounded result (30 October 2026)

## A. Executive result

**PARTIAL visual milestone; not an AAA-completion or Android-performance claim.** A conspicuous circular sky cutout appeared across the noon and night street captures: the 420 m skydome crossed the gameplay camera's 360 m far plane and the cockpit mirror cameras' 105 m far planes. The sky is now a camera-following, local-direction, early-rendered 90 m sphere; matched street images show a continuous sky without the circular seam at noon, rain, dusk and night. This is the strongest demonstrated visual gain. It does not fix flat facades, extremely dark night streets, road texture quality, or the full visual brief. No art assets, props, polygons, textures, traffic, road geometry, physics, contact behavior, camera logic, UI or Android settings were changed. Material/lighting/world improvements beyond this sky correction remain open pending convincing matched evidence and phone profiling.

## B. Skills learned and used

- Searched `/home`, `/opt`, `/usr/local/share`, and the filesystem for `SKILL.md`, `Console`/`console` skill documentation and repository guidance. **No installed Console, Three.js, WebGL, art, or mobile skill instructions were found.** No connected skill library is present. Did not invent or install one.
- Read Vercel Labs' **find-skills** `SKILL.md` directly from its official GitHub repository. Applied its provenance/quality checks and declined to execute an unknown installer or third-party skill. This is a discovery skill, **not** a rendering/Console skill.
- Read the project's existing renderer, weather, geometry, texture and visibility implementation, the prior graphics/Android/test reports, and local Three.js APIs for `ShaderMaterial`, `SphereGeometry`, `onBeforeRender`, render order and `WebGLRenderer.info`. Applied a camera-following skydome with no added render passes; used the existing Puppeteer/Chromium console-event capture as the **Console skill fallback**.
- Authoritative online Three.js manual pages were not retrieved in this environment; do not attribute this fix to an unread external skill or manual.

## C. Baseline and environment

Original/live branch `arena/1cbc19eb-banglar-tesla`, original HEAD `2dc02d776b2cdb520f53471f08fcb51e6fdf251e`. The checkout was already dirty: modified Android packaging, AI, renderer/world, game, UI and tests, plus untracked previous reports, wrappers, graphics fixtures and the contact pass. No staged changes were found. This pass preserves that work. Prior `docs/GREAT_GRAPHICS_UPDATE*.md`, `docs/AAA_GAP_PASS_REPORT.md`, README, Android build guide and relevant source were inspected before game-code edits.

`npm run build` built the **pre-change** web bundle. `node tests/e2e/cinematic-audit.mjs --tag=before` captured 11 initial scenes in Chromium headless with ANGLE/SwiftShader software WebGL, 960×540, DPR 1, Balanced quality, manually fixed cameras/FOV/time/weather and player at (42,106), city RNG `mulberry32(20261207)`. Traffic spawn itself was not fixed; therefore not every incidental vehicle pixel is guaranteed identical. No physical phone or Android GPU was available. The separate console fallback used 915×412, 23 scripted state stages. Baseline `audit.json`: 279 geometries, 19 textures, 65 programs, approximately 5.37 MiB of *scene material image buffers* (width×height×4, mip estimate; excludes GPU render targets, browser and compression). 11 baseline scene checks recorded **zero** page errors, failed requests, HTTP errors, WebGL errors or captured warnings.

## D. Changes by subsystem

| Subsystem | Change / reason | Cost and limit |
|---|---|---|
| Atmosphere/sky (`src/world/environment.ts`) | Skydome radius 420→90 m, local rather than world-position shader direction; render first with depth writes already disabled, follow each active camera via `onBeforeRender`, opt out of frustum rejection. Removes the circular far-plane cutout in gameplay and the 105 m cockpit mirror frustum without new draw passes. | Same shader/material/texture/mesh count. `onBeforeRender` copies one existing vector and updates one matrix per render, including mirrors. Sky does not cast shadows or obscure farther geometry because it renders first without writing depth. |
| Materials, road surfaces, direct/ambient lights, shadows and color | **Unchanged.** Existing sRGB + ACES, dry/wet road materials, phase lighting, fog and shadows preserved; no unmeasured material shader or post-process introduced. | Not a claim of realistic PBR or improved shadow quality. |
| Dhaka/DRMC art, potholes, player/NPC vehicles, weather/rain, cockpit mirrors, LOD/chunks | **Unchanged.** Their existing fixtures ran as regressions; new sky follows the different mirror cameras. | Full scene-by-scene art acceptance and live-phone GPU cost remain open. |
| Tests (`tests/unit/cinematic-sky.test.ts`, `tests/e2e/cinematic-audit.mjs`, `tests/e2e/cinematic-console.mjs`) | Mirror-far-plane invariant, fixed-camera screenshot/stat fixture, console/request/WebGL-stage fallback. | The road-close screenshot in the audit is blocked by the player canopy: **invalid road-detail visual evidence**. The fixtures are staged, not a physical drive. |

## E. Matched software-renderer measurements

[Raw before](../artifacts/cinematic-realism-before/audit.json) · [raw after](../artifacts/cinematic-realism-after/audit.json). `renderer.info` describes the last single render; ten warm renders per scene were wall-timed with `performance.now()` (three warmups). Timing values are noisy SwiftShader/CPU wall times, **not GPU time or phone FPS**. Renderables are actual `onBeforeRender` callbacks. The camera/FOV/hour/weather/quality/viewport match; NPC spawn is not fully deterministic. Numeric texture-memory estimate is not a complete GPU memory figure.

| Scene | Calls before→after | Triangles before→after | Renderables | Geometry / textures / programs | Render wall p50 before→after (ms) | p95 before→after (ms) |
|---|---:|---:|---:|---:|---:|---:|
| Commercial noon | 154→154 | 532,147→530,779 | 132→132 | 279 / 19 / 65 both | 5.2→6.1 | 8.9→11.2 |
| Residential noon | 112→111 | 468,169→447,389 | 90→89 | 279 / 19 / 65 both | 3.3→2.2 | 10.7→11.9 |
| DRMC noon | 93→93 | 369,311→368,915 | 71→71 | 279 / 19 / 65 both | 1.3→2.7 | 6.8→7.4 |
| Golden hour | 161→161 | 546,895→545,527 | 138→138 | 279 / 19 / 65 both | 1.7→2.0 | 4.2→8.4 |
| Night | 160→160 | 533,599→532,231 | 138→138 | 279 / 19 / 65 both | 1.7→1.6 | 5.1→2.9 |
| Rain day | 158→158 | 532,531→531,163 | 136→136 | 279 / 19 / 65 both | 1.6→1.4 | 6.7→9.0 |
| Far view | 205→205 | 705,199→703,831 | 183→183 | 279 / 19 / 65 both | 1.5→1.4 | 8.7→3.2 |

**Assessment:** no established speedup. Several p95s and noon p50 got worse; residential incidental traffic differs by one draw and ~20k triangles, so the world is not pixel-identical. No extra geometry/texture/program allocation was observed in these fixed scenes. The old sky was partly clipped, which explains some triangle changes; lower triangles alone are not proof of faster gameplay. Existing independent frustum fixture: front 175 calls/578,845 triangles, left 128/535,946, behind 52/263,132; 12 visibility cycles held 279 geometries, 19 textures, 67 programs and 37 fleet children.

## F. Visual evidence

Manifest: `artifacts/cinematic-realism-manifest.json` (11 pairs with camera, FOV, weather, hour, preset, viewport and qualification). Files reside under `artifacts/cinematic-realism-before/` and `artifacts/cinematic-realism-after/`, with identical basenames: `commercial-day`, `residential-day`, `drmc-day`, `road-close`, `golden-hour`, `dusk`, `night`, `rain-day`, `storm-night`, `hero-day`, `environment-far`. Opened and inspected both **commercial-day** and **night** screenshots: before, a giant sky/background circular seam; after, continuous sky. Opened `rain-day` before and `road-close` after. The road-close frame is obscured by the player canopy and must **not** be used as road-quality evidence. This is not a complete requested scene matrix: no fully matched cockpit/chase, NPC close-up, actual pothole/drain, near/medium/far vehicle sequence or Performance/Balanced/High screenshot triplets. The sky fix is visible, but other visual families are not certified by these captures.

## G. Console/runtime diagnostics

The baseline screenshot run: 0 captured warnings/errors/failed requests/HTTP errors, 0 WebGL errors in 11 staged scenes. After run: same. After-only `artifacts/cinematic-realism-after/console.json`: **23 stages**, including boot, Low/Balanced/High, noon→dusk→night→dawn, sunny→rain→storm→sunny, chase↔cockpit, world chunks, pause/resume and 200 scripted traffic frames: 0 captured warnings, exceptions, failed requests or HTTP errors; `gl.getError()=0` throughout. Programs grew to 85 across preset/weather variants (65 in the fixed Balanced audit); not proof of a leak. The 12-cycle visibility audit kept its resource counts stable. This is not a proof that every asset load, shader, hours-long session or device console is clean.

## H. Exact tests and limitations

- `npm run build` before edit passed; after edit `npm run typecheck`, `npm test` **222/222** (34 files), `npm run build`, `git diff --check` passed.
- `node tests/e2e/cinematic-audit.mjs --tag=before` and `--tag=after`: 11 scenes each; 0 runtime diagnostics in the capture stage. `node tests/e2e/cinematic-console.mjs --tag=after`: 23 stages, 0 captured issues/WebGL errors. First console-fixture attempt failed because `g.pause` is not an API; fixture corrected to existing `g.togglePause` and then passed. Not counted as a pass for the first run.
- `npm run test:e2e` **21/21**, `npm run test:mobile` **13/13**, `npm run test:ui` **33/33**.
- `node tests/e2e/graphics-road.mjs` passed (8 authored potholes, depth 0.065 m); `node tests/e2e/graphics-rain.mjs` passed (408 rain drops, clear cleanup); `node tests/e2e/graphics-mirrors.mjs` passed (cockpit renders/chase stops); `node tests/e2e/visibility-audit.mjs --tag=cinematic-after` passed including frustum/cycles/presets/weather resource audit.
- Existing full unit suite covered traffic/turn, rig, pothole, save/settings, weather, race and DRMC. Dedicated current-turn live race drive, long traffic stress, seven-kind LOD sweep and Android GPU/thermal tests **not rerun**; past reports do not substitute for these new-run passes.

## I. Android status

`python3 scripts/build-apk.py --check` failed: **Android SDK not configured** (no `ANDROID_HOME`/`ANDROID_SDK_ROOT`/`android/local.properties sdk.dir`). `java` and `adb` absent from PATH. Official JDK 17, platform 34 and Build Tools 34.0.0 not available here; no APK output, installation, physical phone test, GPU FPS, memory, thermals or battery measurements. Android package `com.shostalab.banglartesla`, minSdk 24, versionCode 7 and versionName 0.6.0 were not changed. No third-party `aapt2` used.

## J. Acceptance ledger

| # | Criterion | Status | Evidence / gap |
|---:|---|---|---|
| 1 | Realistic material response | PARTIAL | Existing families inspected; no material changes; nighttime facade/road still stylized. |
| 2 | Daylight lighting | PARTIAL | Circular sky cutout fixed in matched noon view; overall lighting not fully art-reviewed. |
| 3 | Dusk/night lighting | PARTIAL | Sky cutout fixed in matched night view; street remains very dark. |
| 4 | Shadow quality/stability | PARTIAL | Existing filtered shadows and unit/browser tests preserved; no exhaustive camera-motion or phone proof. |
| 5 | Dhaka environmental density/variation | PARTIAL | Existing 29 infills/22 courtyards preserved; residential/DRMC captured, no new art. |
| 6 | Road surface realism/readability | NOT TESTED | Close-road capture occluded by canopy; pothole browser fixture is physics/geometry only. |
| 7 | Player rickshaw visual quality | PARTIAL | Hero/day capture, rig units; no new hero materials or full zoom/preset evaluation. |
| 8 | NPC vehicle visual quality | PARTIAL | Existing vehicle units/visibility fixture; no matched new NPC close-up matrix. |
| 9 | Rain/wet-road presentation | PARTIAL | Rain browser cleanup passes; staged rainy view captures sky fix, no complete visual quality audit. |
| 10 | Fog/atmosphere | PARTIAL | Sky continuity proven; fog preserved; no all-weather visibility/phone test. |
| 11 | Cockpit/chase correctness | PARTIAL | Mirrors browser test passes; no matched cockpit/chase screenshots in this pass. |
| 12 | Near/medium/far LOD | PARTIAL | Prior seven-kind sweep, current units/visibility audit; full transition sweep not rerun. |
| 13 | Frustum culling | VERIFIED | Current `visibility-audit.mjs` front/side/behind and synthetic entry/exit. |
| 14 | Distance culling | PARTIAL | Current preset front/back visibility; complete natural distance audit not rerun. No occlusion claim. |
| 15 | Resource stability | VERIFIED | Current 12 visibility cycles stable; 23-stage console run 279/19 at end. Not indefinite stability. |
| 16 | Console cleanliness | PARTIAL | 0 captured errors in staged runs, not an exhaustive all-systems/device console. |
| 17 | Browser/software-renderer performance | VERIFIED | Matched scene cost/timing numbers above; **not improved performance**. |
| 18 | Physical Android GPU performance | BLOCKED | No device/toolchain; no FPS claim. |
| 19 | Android APK build | BLOCKED | SDK preflight error; no APK. |
| 20 | Physical-device gameplay | BLOCKED | No APK or Android device. |

## K. Remaining priorities

1. **Visual:** proper fixed road/pothole/drain capture and legible wet/night road, fuller storefront material response and hero/NPC close-up evaluation. Any art changes require new *pre-change* baseline and matched render cost.
2. **Visual/perf:** full seeded scene matrix, deterministic NPC staging, cockpit/mirror and near/medium/far captures in all three presets, a meaningful long traffic/drive browser stress. Software-renderer timing already shows variable/worse tail latency.
3. **Release/toolchain:** install trusted JDK 17 and official Android SDK/Build Tools 34/adb on a trusted machine; build a verified APK and measure on a physical Android GPU, including thermal and frame pacing.

## L. Git safety

Original and final HEAD: `2dc02d776b2cdb520f53471f08fcb51e6fdf251e` on `arena/1cbc19eb-banglar-tesla`. This task changed only `src/world/environment.ts`, added `tests/unit/cinematic-sky.test.ts`, `tests/e2e/cinematic-audit.mjs`, `tests/e2e/cinematic-console.mjs`, this report, and appended a milestone note to the existing graphics requirements ledger. All other dirty/untracked changes were pre-existing and preserved. Generated evidence is ignored under `artifacts/`. No reset, clean, destructive restore, staging, commit, amend, rebase or push occurred. Final `git status --porcelain`: 34 modified tracked paths and 44 untracked paths (including pre-existing work and the six paths of this pass); zero staged paths. The complete live status remains available in the repository. `git diff --check` passed.
