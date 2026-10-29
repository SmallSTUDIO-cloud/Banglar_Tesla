# Great Graphics Update — test and visual QA report

29 October 2026; branch `arena/1cbc19eb-banglar-tesla`. All numbers below are **headless Linux Chromium 153 / SwiftShader, 915×412** unless explicitly noted. They are not phone measurements, GPU timings or a sustained real-time FPS claim. Baseline and after JSON: ignored local `artifacts/benchmark-graphics-start.json` / `artifacts/benchmark-graphics-after.json` (not committed, reproducible with `node tests/e2e/benchmark-suite.mjs --tag=graphics-start|graphics-after`). The suite does not run the same preselected traffic seed or repeat each scenario, and its long-drive software-renderer stalls are extreme; do not infer an overall speedup.

## Executed checks

| Command | Result | Limitations |
|---|---|---|
| `npm ci`, `npm run typecheck`, `npm run build`, `npm test` | Pass; 170/170 unit tests across 21 files; final JS bundle ~1,219 kB | Unit physics corridor tests do not establish all street intersection behavior |
| `npm run test:ui` | 33/33; actual DOM clicks for dedicated screen, presets, Normal/Dynamic choice, Custom reload, reset/audio/weather independence, Back, portrait weather; no page errors | Screen drag and every rapid toggle/orientation combination not stress-tested |
| `npm run test:e2e` | 21/21 | Browser fixture coverage includes scripted events |
| `npm run test:spec`, `npm run test:upgrade`, `npm run test:v05` | 12/12; 17/17; 13/13 | Browser tests, not Android device |
| `npm run test:vnext` | 9/9 after updating test for Dynamic-only screen drops; initial run 8/9 expected legacy Normal drops, corrected by testing both states and no drops in sun | Race/photo progression uses teleports as fixtures |
| `npm run test:vnext-repair` | 9/9 (last line includes no browser errors) | Nearby-caller/ride-positioning fixture |
| `npm run test:mobile` | 13/13 touch/control/layout and Back actions | Headless mobile viewport emulation, not touch hardware |
| `node tests/e2e/stress-v2-benchmark.mjs` | 9/9 including 15-minute simulated step trace: 302 geometries/19 textures stable; heap 11.39→11.89MB | Software renderer and synthetic steps |
| `npm run build:apk` | **Blocked** twice; production Vite build succeeds, packaging immediately asserts missing `/tmp/android-tools/node_modules/aaptjs3/bin/x64/linux/aapt2` | No verified APK, signature, metadata inspection or physical-device result |

One mistaken invocation of nonexistent `tests/e2e/stress.mjs` failed with MODULE_NOT_FOUND; the actual `stress-v2-benchmark.mjs` was then executed and passed. This is not a stress regression. No claimed post-change normal-input physical boss win; earlier fixture and prior physical-run limitations in `docs/RECOVERY_QA.md` still apply. No audio listening or real phone checks.

## Comparable-but-not-identical software-renderer observations

Format: baseline → after, **calls / triangles / p50 ms / p95 ms / retained heap MB**. 3D renderer geometries/textures/programs stable at **276 / 16 / 31** across world scenes; garage 303 / 20 / 39 (repeated missions after 305 / 20 / 39). Each row is one suite pass, not repeated confidence intervals; GPU async timing was **null** even though a timer extension was detected.

| Scene | Baseline → after | Shadows baseline → after |
|---|---|---|
| Menu | 194/631,184/4.40/7.77/9.42 → 194/626,408/4.23/8.33/9.41 | 41→41 |
| Normal street drive | 176/608,682/7.05/11.92/10.05 → 170/608,414/3.82/17.10/10.04 | 45→45 |
| Town Hall market | 164/557,012/3.58/8.38/10.06 → 164/557,012/2.27/8.27/10.08 | 42→42 |
| Heavy jam | 180/607,754/4.23/485.4/10.40 → 180/605,306/3.10/15.20/10.44 | 43→43 |
| High-density scenario | 178/682,954/2.25/6.17/10.47 → 178/678,362/3.48/327.93/10.49 | 43→43 |
| Seven-camera rapid switch | 168/585,248/5.73/2135.63/10.53 → 170/585,164/3.33/2666.63/10.53 | 41→41 |
| Long continuous drive | 212/725,877/3.99/18317.37/10.89 → 216/726,765/3.62/642.39/10.87 | 41→43 |
| Garage/showroom | 37/21,148/0.50/1.13/11.20 → 37/21,148/0.23/4.30/11.19 | 5→5 |
| Eight missions | 168/532,088/2.07/4.45/11.67 → 227/721,316/3.58/6.40/11.66 | 44→44 |

These observations **do not prove an improvement**. Visual and simulation states varied (notably eight missions), and p95 software stalls range from ~1ms to >18 seconds. The historical 245-draw reference was met in these runs, but screenshots are not available for matching world scenes and the sampled presets do not cover the requested Performance/Balanced/High/Custom × Normal/Dynamic rain matrix.

## Visual checks / missing coverage

- Inspected `artifacts/graphics-custom-portrait.png` from the actual English Graphics screen at 412×915: quality/preset, scale, FPS, shadows, rain and reset labels are readable and controls fit horizontally. The final Back button is below the fold, but the sheet is vertically scrollable and the close button is visible. Some World-view art is visible behind the glass panel; no assertion of improved world art.
- Pre-existing screenshots, including prior `artifacts/01-menu.png`, are **not** controlled before/after scene comparisons for this update. No matched day/night/wet/cockpit/race captures or physical device recordings were taken. Driver, passenger, rival and rear-view mirror visual acceptance remains open.
- Quiet-hours boundary continuity has deterministic unit tests (23:59→00:00 and 06:59→07:00); no time-lapse capture or night pedestrian count test. NPC yield tests cover ahead/behind/crossing and left/right forward headings; no full browser left/right/wide-vehicle stop-resume route capture yet.

## Acceptance criteria audit (master prompt §11)

| # | Criterion | Status and exact evidence/blocker |
|---|---|---|
| 1 | Skills researched/read/applied | **Partial** — read Vercel find-skills guidance and official engineering references; no relevant runnable trusted repo skill installed. |
| 2 | Every major requirement mapped/rechecked before implementation | **Pass for planning** — pre-code plan covers all sections; this report flags incomplete delivery. |
| 3 | Dedicated Graphics entry/screen | **Pass** — UI click-through. |
| 4 | Every exposed graphics option real or honest fallback | **Pass for exposed controls only** — screenshot/UI and implementation; most requested options not exposed at all. |
| 5 | Performance/Balanced/High/Custom persist | **Pass for implemented subset** — profile, edit, reload, weather independence; full requested preset parameter coverage missing. |
| 6 | Weather selection independent/persistent | **Pass** — six states and reload UI tests. |
| 7 | Normal efficient; Dynamic wind/near/splashes/droplets | **Partial** — pooled drops, greater wind and screen droplets; **no wheel splashes/near rain calibration**. |
| 8 | Wet road/puddles/headlights/store lighting at night | **Partial/untested** — old wetness reused with toggle; no new puddles or night visual verification. |
| 9 | Gradual lighting/sky/time plus 00–07 population/CNG | **Partial** — ambient traffic factor/CNG spawn; sky lighting/phase transitions and pedestrian schedule remain hard-phase/unchanged. |
| 10 | City gaps/details/roads navigation preserved | **Not delivered** — no new frontage art; existing road layout preserved. |
| 11 | Visible potholes with type-specific response | **Not delivered**. |
| 12 | Stable physics/control changes | **Partial** — bounded frame pacing; no new wet traction, bump/suspension/collision tuning or real input comparison. |
| 13 | Smooth NPC turns and front-only yielding | **Partial** — front corridor and junction damping, unit/browser regressions; wide-turn/intersection physical QA incomplete. |
| 14 | Driver-camera functional mirrors | **Not delivered**. |
| 15 | Vehicle/driver rig visually verified | **Not delivered this update** — prior captures not equivalent to new verification. |
| 16 | Map/navigation matches graph | **Not reverified across modes** — unchanged graph; existing route tests pass. |
| 17 | Per-preset/weather performance and matching captures | **Not delivered** — one baseline/after default-software suite, portrait UI capture only. |
| 18 | No existing content deleted to fake performance | **Pass** — no geometry/assets/city/road/map deletion. |
| 19 | Typecheck/build/suites/stress | **Pass for named suites** (above); not all requested bespoke visual, gameplay and device tests. |
| 20 | APK legitimately attempted or exact blocker | **Pass as blocked** — missing aapt2 assertion; no APK or device validation. |
| 21 | Normal checkpoint commits/push; no history rewrite/PR | **Pass** — see git log; remote reconciled by preservation commit and ordinary merge. |
| 22 | Finished/partial/blocked/untested distinguished | **Pass in this report**. |

Unimplemented items must not be inferred from a green generic E2E run. The master brief's full validation matrix (§10) remains mostly open. Next work should start with real NPC input QA and baseline screenshot fixtures; then coherent sky/frontage/roads, meaningful mirror and rain effects, exhaustive settings implementation and matched physical-device testing before calling this a Great Graphics Update.

## Revision 2 validation — 29 October 2026 (post-code)

| Command / evidence | Result / limits |
|---|---|
| `npm run typecheck`, `npm run build`, `npm test` | PASS; final build after wind/audio adjustment and **179/179** units across 25 files. |
| `node tests/e2e/graphics-mirrors.mjs` | PASS browser fixture; cockpit render counter advances; chase stays static; 279 geometries / 18 textures in both sampled states. Post-position screenshot `artifacts/v2-driver-mirrors.png` visually inspected. |
| `node tests/e2e/graphics-road.mjs` | PASS browser fixture: 8 authored potholes, 26 eligible infills, hole depth 0.065 m, terrain center -0.051 m, scripted vehicle movement; screenshot `artifacts/v2-pothole-drive.png`. Not a race or phone run. |
| `npm run test:ui` | PASS 33/33 graphics/weather/persistence/UI clicks. |
| `npm run test:spec` | PASS 12/12, including seven cameras and steering/wheel-contact checks. |
| `npm run test:mobile` | PASS 13/13 browser touch and orientation checks, not physical Android. |
| `npm run test:vnext-repair` | PASS eight browser checks on caller/bargaining/race/escape; script reports no page error. |
| `node tests/e2e/benchmark-suite.mjs --tag=v2-final` | Saved `artifacts/benchmark-v2-final.json`; pre-code comparator `artifacts/benchmark-v2-current.json`. SwiftShader-only; normal p95 regresses 5.83→7.70 ms, long-drive p95 improves 22.57→9.63 ms; 15-minute simulated fixture at 5/10/15 min reports 307 geometries/22 textures and ~12.02/12.10/12.18 MB retained. Rendering p95 outliers in jam/high reached ~960/3872 ms, requiring investigation; async GPU timing unavailable. Benchmark executed before final small wind/audio feedback amendment, so **not identical to the final commit**. |
| `npm run build:apk` | **BLOCKED** after web production build: `AssertionError: Missing aapt2 at /tmp/android-tools/node_modules/aaptjs3/bin/x64/linux/aapt2`; no APK, signing/package metadata inspection or real-device result. Official Android SDK/CI provision and retry required; preserve `com.shostalab.banglartesla`, minSdk 24. |

The road and mirror captures are browser fixture screenshots under a software renderer, not a full human-driven race/night/rain gallery. The full NPC junction/blocked-traffic and map-corridor matrix, every settings-control inspection, complete quality-preset × weather × camera captures and audio audition remain **unverified**. Prior event/trigger tests cannot substitute for listening to generated sound. Re-read the 855-line v2 brief for the second stable-ID audit; `GREAT_GRAPHICS_UPDATE_REQUIREMENTS.md` keeps 590 rows with conservative states. The final result is partial, not the requested complete acceptance.
