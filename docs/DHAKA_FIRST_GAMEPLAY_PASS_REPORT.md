# Dhaka-first realism & emergent gameplay — partial pass

**Executive result: PARTIAL.** This pass researched Dhaka/Mohammadpur, audited the existing authored map and intertwined systems, and made a small safety/truthfulness correction to free-roam event scheduling. It did **not** deliver a fully realized Dhaka simulation, several newly interactive event families, a surveyed map, Android release evidence, or an exhaustive live scenario signoff. The core identity needs further local art/behavior review. All existing dirty work was protected.

## 1. Research actually used

Research was completed **before implementation** in [`DHAKA_REALITY_NOTES.md`](DHAKA_REALITY_NOTES.md), with dates, URLs, verified/dated/inferred/unknown categories, visual/audio checklist and source-backed opportunities. Sources actually read: UNESCAP 2019 transport brief (mixed modes; historic, **not current speeds**); Debnath et al. 2021 AUST/BUET pedestrian decision-making study; Rahman/Nilufar 2024 KUET/BUET land-use activity nodes; Kabir 2023 AUST Town Hall market case study; Bangladesh Tourism Board's undated Sat Gambuj heritage page; and Razi's 25 July 2026 *Daily Star* account of three Mohammadpur street types. Their key design implications: preserve the existing mixed rickshaw/CNG/bus/pedestrian street network; distinguish market frontages, residential lanes and connectors; favor cautious, navigable market/footpath interactions. No source proves the precise position of every modeled building, gate or shop. One supplied World Bank PDF returned **403** and was not used as a read source. No old transport number was promoted to a 2026 statistic.

Skills discovery: searched local workspace/home for relevant `SKILL.md` and inspected project tool guidance before implementation. No relevant installed Three.js, AI/traffic, Console, mobile, accessibility or Android skill instructions were found; none was installed. Used existing Puppeteer, Vitest, TypeScript and project source instead. No claim of using an unavailable Console skill.

## 2. Map and systems audit

See [`DHAKA_FIRST_MAP_AND_EVENTS.md`](DHAKA_FIRST_MAP_AND_EVENTS.md) for the location/zone and interaction matrices written before edits. The map is a compressed OSM-derived *project dataset* with `source: 'osm'` ways and openly marked `approx_lane` fictionalized connectors; **its OSM IDs and exact placement were not independently reverified against a fresh live OSM export**. Town Hall at in-game (42,106), `asad_3/4` and `shershah_1/2` are appropriate *game-graph* market connectors, not a surveyed real-world-coordinate claim. Existing `ring_3` market, Nurjahan/Salimullah residential connections and two DRMC gates were kept. Sat Gambuj Mosque is verified as a real Mohammadpur landmark but no game placement was verified, so **none was added**. Existing pedestrian/vendor/shops/audio/traffic models were audited as project systems, not redesigned. No campus civilian spawning rule was changed.

Existing economy starts at ৳500; baseline passenger E2E observed a paid job and persisted balance. Existing roadside bargaining, rival events, police pursuit, authored races, weather, roadblocks, save schema and score were already implemented. No prices, fares, unlocks, audio assets, traffic AI, physics, road geometry, density or Android identity were changed. A risk remains in the pre-existing score system's impact/destruction rewards; this pass only removed an automatic fake impact from a photo-style director event and disabled scheduling a photo that no player took. A full risk/reward redesign remains outstanding.

## 3. Task changes and player-visible behavior

- `src/events/eventDirector.ts`: choose only **authored public main/medium road midpoints** for events, 32–90 game metres from the player; reject dead ends, DRMC boundary/gate aprons and unsafe overlaps. Market slowdowns require an existing `jamProne` segment. Add a 90-second initial/global cooldown and 120-second per-kind cooldown. RNG remains injectable/deterministic. Manual weather disables automatic storm nudges; no random off-road event positions. Disable the director's **unowned** construction/police barricades, fake collision/vehicle, fake street challenge, and unperformed photo events rather than announcing unsupported hazards/rewards. Their existing types are retained for compatibility but are not selected by this director.
- `src/game.ts`: realize a market slowdown as a short, bilingual **nonblocking** advisory plus the existing decaying congestion/route-cost mechanism (nine-second director lifetime; no new vehicle is fabricated). Auto-weather cues drive the existing weather director. Clear active director events as soon as a mission, race or mode transition begins and on protected active-play transitions. Do not automatically grant crash score for a photo. This is **not** a new physical road incident or passage choice UI.
- Focused test updates: `tests/unit/scrapbook-events.test.ts`, `tests/unit/vnext-repair-drmc.test.ts` adjust prior tests that assumed arbitrary polar offsets/regular overlapping events; new `tests/unit/dhaka-first-events.test.ts` covers seeded sites, DRMC/gate clearance, cooldown, protected states, per-event cleanup, manual weather and decaying route cost. New `tests/e2e/dhaka-first-events.mjs` exercises the actual Game callbacks for both market and auto-weather cues. New `tests/e2e/dhaka-first-capture.mjs` writes **task-specific** before/after captures without replacing prior visual-pass screenshots.
- New docs: research notes, map/event plan, this report; new ignored `artifacts/dhaka-first-pass/` and `artifacts/dhaka-first-pass-manifest.json` for evidence. No render/geometry/asset/audio change.

### Event interaction matrix (status)

| Family | Cause / eligibility | Existing systems and observed outcome | Cleanup / reward / status |
|---|---|---|---|
| Passenger/market pickup | Existing safe sidewalk caller and nearby job offer; no incompatible mission/race | Pedestrians → mission → fare negotiation → passenger actor → fare/save; baseline E2E and `test:vnext-repair` cover accept/decline/payment | Existing actor cleanup and once-only fare; **VERIFIED as preserved**, not newly built. |
| Market-edge slowdown | Free-roam, public jam-prone midpoint, distance and campus clearance | Director → `TrafficSystem` congestion modifier → road-graph route-cost hint + localized toast; `live-director.json` observed multiplier **3.7** at (80,95) | Nine-second event; injected cost exponentially decays, no money or colliders; **VERIFIED in scripted real Game**, not a full live drive through the cue. |
| Auto-weather cue | Free-roam, dry, weather preference Auto | Director → existing `WeatherDirector.setWeatherImmediate('storm')`, observed storm in Game; manual weather blocked by tests | Existing weather lifecycle; no reward or forced mission; **VERIFIED in scripted real Game**, not a measured natural rain transition. |
| Police/rival | Existing heat/checklist/route rules, independent of director | Existing `test:vnext-repair` tests pursuit and race, live race retried | Existing systems preserved; **PARTIAL** for new interactions, director-owned barricades disabled until safe ownership exists. |
| Construction/broken vehicle/vendor/photo/street challenge | Disabled in director | Existing specialized systems remain, but director has no safe owned world object or actual capture/action to support those claims | **NOT IMPLEMENTED here**, no fake event announcements. |

This does **not** meet the master prompt's ambition of multiple **new** interactive event families with player choices and fully linked rewards. No fabricated success is claimed. No save-schema migration or new event currency exists. The menu/mission/race transition clears director state; HUD toasts provide English/Bangla feedback with no additional timers, DOM listeners or assets. The new director code does not alter Low-preset event logic.

## 4. Traffic, physics and gameplay checks

No traffic AI, pedestrian AI, collision geometry, vehicle contact/pushing or authored race routing code changed. Unit tests exercised road-safe event placement/route graph and campus clearance; existing 35-file suite covers junction, contact, weather, pedestrian quiet hours and DRMC. Browser E2E covers passenger job/persistence and low preset. New scripted browser harness confirmed real Game event callback and GL error **0**, 279 geometries/19 textures after two events, zero captured page/console/request/HTTP diagnostics; it is **not** a long keyboard-driving test. A separate keyboard-driven DRMC route completed, with **2 reported hits**, 0 recoveries and no browser error (see `artifacts/dhaka-first-pass/drive-drmc.log`); hits do not establish that every contact was harmless.

**Race variance:** first current-task live race run failed its 115-second deadline: player encountered traffic repeatedly near (117,85), needed two recoveries, reached all four checkpoints at 106.8 seconds but timed out at 115. The rerun completed all four at **79.5 seconds** with no recovery and **lost to a 67.3-second rival**. Neither run is a win. The race-specific director is disabled during active races; this failure's precise baseline attribution was **not** reproduced in a before-code live race, so do not label it fixed or a proven pre-existing bug. It remains a nondeterministic traffic/pin risk requiring isolated reproduction, not an invitation to rewrite unrelated NPC AI without evidence. Collision detection and displacement fairness were not fully measured in this pass.

## 5. Visual and performance evidence

`artifacts/dhaka-first-pass-manifest.json` indexes **37 before + 37 after** task-specific PNGs, metrics, exact per-scene camera/FOV/weather/preset and caveats. Both captures: 960×540/DPR1, Node v22.22.3, Chromium 153.0.8010.0, ANGLE/Vulkan **SwiftShader software renderer**, seeded city with ambient NPCs and pedestrians hidden/frozen in the controlled visual fixture. Road, market/commercial, residential, DRMC exterior, rain and night have images; actual DRMC campus population restrictions rely on tests, not a campus-interior screenshot. Passenger/race/police states were tested separately, **not** before/after screenshots. `before/commercial-balanced.png` and `after/commercial-balanced.png`, and `before/drmc.png` / `after/drmc.png` were opened and visually inspected. There is no visual change in those frames: this is an event-logic pass, **not** a fabricated scene improvement. Camera-pair HUD state differs and is flagged non-pixel-matched in the manifest. Live director screenshot (`live-director.png`) depicts a scripted post-change state only; it has no matching before-event screenshot.

| Matched scene | Calls before → after | Triangles before → after | Rendered callbacks | Geometries / textures / programs |
|---|---:|---:|---:|---:|
| Commercial Performance | 119 → 119 | 363,647 → 363,647 | 121 → 121 | 279 / 17 / 93 → same |
| Commercial Balanced | 127 → 127 | 451,275 → 451,275 | 121 → 121 | 279 / 19 / 93 → same |
| Commercial High | 128 → 128 | 451,323 → 451,323 | 121 → 121 | 279 / 19 / 93 → same |
| DRMC exterior | 73 → 73 | 308,599 → 308,599 | 67 → 67 | 279 / 19 / 93 → same |
| Residential | 92 → 92 | 407,457 → 407,457 | 86 → 86 | 279 / 19 / 93 → same |
| Night road | 131 → 131 | 567,089 → 567,089 | 125 → 125 | 279 / 19 / 79 → same |

Matched controlled scenes show no geometry/draw-cost change; they **hide traffic/event life**, so cannot establish event runtime FPS. Render-wall median for Balanced is noisy SwiftShader measurement, not a frame-cadence FPS or Android GPU result. The 23-stage Puppeteer diagnostic (`artifacts/dhaka-first-pass/console-after.json`) recorded **0 console/page/request/HTTP events, 0 GL errors**, and both 37-scene captures recorded 0 fixture diagnostics. Current stress (`artifacts/dhaka-first-pass/stress.json`) completed **9/9 checks**, including 54,000 fixed steps = **15 simulated minutes**, six menu/scene cycles with resources stable at 305 geometries/22 textures, final heap 12.35 → 12.75 MB (+0.40 MB). That stress is **not** a continuous 15-minute live drive. Worst-case SwiftShader render wall included a **1257.34 ms spike** in the storm profile; no smooth-device-FPS or stable hardware benchmark claim. Unit seeded runs simulate 600 seconds of event selection with no site overlap/campus placement, not actual 600-second gameplay.

**Evidence preservation caveat:** the generic `cinematic-gap-console.mjs --tag=after` diagnostic has a hard-coded output under the *previous* gap-closure artifacts. It refreshed that prior ignored console JSON before the new output was copied to `artifacts/dhaka-first-pass/console-after.json`. This inadvertent refresh of one ignored prior diagnostic file is acknowledged; earlier PNGs/reports were not replaced. The earlier stress JSON was explicitly backed up, the new result copied to this task directory, and the older file restored. Future harnesses should accept an explicit output directory to prevent this collision. Ignored artifacts are local and may not persist across workspace resets; keep a copy before clearing the environment.

## 6. Test table (completed runs; setup failures separate)

| Command / evidence | Outcome |
|---|---|
| `npm run build` (`build.log`), includes `tsc --noEmit` | PASS after final code edit. |
| `npm test` (`unit-final.log`) | **35 files / 226 tests passed** after final code edit; initial baseline was 34 / 222. |
| `npm run test:e2e` (`e2e.log`) | **21/21** passed after lifecycle changes; before final 90-second cooldown tweak. |
| `npm run test:mobile` (`mobile.log`), `npm run test:ui` (`ui.log`) | **13/13** and **33/33** passed before final cooldown tweak; no Android device implied. |
| `npm run test:vnext-repair` (`vnext-repair.log`), `npm run test:vnext` (`vnext.log`) | **9 PASS lines** and **9/9**, respectively; existing passenger/rival/police workflows, before final cooldown tweak. |
| `npm run test:spec`, `npm run test:upgrade`, `npm run test:v05` | **12/12**, **17/17**, **13/13** passed, before final cooldown tweak. |
| `node tests/e2e/dhaka-first-events.mjs` (`live-director.json`) | PASS after final code edit; scripted real Game, market/weather/cleanup; not a keyboard drive. |
| `node tests/e2e/dhaka-first-capture.mjs --tag=before/after` | **37 + 37 scenes**, 0 diagnostics, after rebuilt from final code. |
| `node tests/e2e/drive-drmc-live.mjs` (`drive-drmc.log`) | PASS, live route completed; 2 hits. |
| `node tests/e2e/drive-race-live.mjs` (`drive-race.log`, `drive-race-retry.log`) | First **FAILED** deadline; second **PASS** completion but lost to rival. Do not count first as passing. |
| `node tests/e2e/stress-v2-benchmark.mjs` (`stress.json`, `stress.log`) | **9/9** stress checks, with software wall-time spike. |
| `node tests/e2e/cinematic-gap-console.mjs --tag=after` (task copy `console-after.json`) | 23 stages; 0 diagnostics / 0 GL errors. |
| `npm run test:android-pipeline` (`android-pipeline.log`) | **FAILED AT SETUP:** Python unittest discovery `tests/build` is not importable/does not exist. **0 tests executed**, not a pass. |
| `python3 scripts/build-apk.py --check` | **BLOCKED:** SDK not configured; `ANDROID_HOME`/`ANDROID_SDK_ROOT` unset, `java` and `adb` not found. |

No other unexecuted suite is counted as passed. A failure/retry is shown explicitly; the Android pipeline setup failure is not disguised as a test pass.

## 7. Android boundary

Official Gradle wrapper files are present (wrapper points to Gradle 8.7); that alone does not establish a working SDK, JDK 17, Platform 34, Build Tools 34, licenses or emulator. `python3 scripts/build-apk.py --check` reports Android SDK not configured; Java and adb are unavailable. No APK was generated, installed or physically tested. No device FPS, battery or touch-performance measurement. Preserve `com.shostalab.banglartesla`, minSdk 24 and existing versioning. Local build, once the official SDK/JDK are installed: configure `ANDROID_HOME`/`ANDROID_SDK_ROOT`, JDK 17 and official Android Platform/Build Tools 34 and licenses, run `python3 scripts/build-apk.py --check`, then `npm run build:apk` and verify/install on an actual device. Do not substitute an unofficial `aapt2` binary or claim APK success from the wrapper alone.

## 8. Git safety and final classification

Starting state: branch `arena/1cbc19eb-banglar-tesla`, HEAD `2dc02d776b2cdb520f53471f08fcb51e6fdf251e`, **0 staged, 34 modified tracked, 49 untracked** paths. Final HEAD and branch unchanged; **0 staged, 36 modified tracked, 55 untracked** paths, verified after this report was written. New task changes: `src/events/eventDirector.ts`; narrowly scoped edits to already-dirty `src/game.ts`, `tests/unit/scrapbook-events.test.ts`, `tests/unit/vnext-repair-drmc.test.ts`; new `docs/DHAKA_REALITY_NOTES.md`, `docs/DHAKA_FIRST_MAP_AND_EVENTS.md`, this report, `tests/unit/dhaka-first-events.test.ts`, `tests/e2e/dhaka-first-events.mjs`, `tests/e2e/dhaka-first-capture.mjs`; task-specific ignored artifacts/manifest. No reset, clean, destructive checkout, stash, branch switch, stage, commit, tag, push or PR. The historical source modifications in the 34 starting tracked paths were not rewritten wholesale. One older ignored diagnostic JSON was refreshed by a hard-coded harness as disclosed above; **do not claim zero pre-existing artifacts touched**.

| Criterion | Classification and next step |
|---|---|
| Dhaka-specific research and source uncertainty record | **VERIFIED** notes with six read sources and explicit unknowns. |
| Mohammadpur zone/map authenticity | **PARTIAL** source-to-graph matrix; coordinates and visual details not ground-truthed in person. |
| DRMC exactly two gates/campus civilian exclusion | **VERIFIED** existing focused tests and no director sites within keep-clear apron; no exhaustive in-game walking census. |
| Several newly interactive families with real choices, fair rewards and localized dialogue | **PARTIAL** two director cues + preserved existing passenger workflow; no new player decision UI or broad reward design. |
| Traffic/pedestrian physical fairness in all dense/narrow/rain/race conditions | **PARTIAL** no AI change, existing suites passed, live race failed once in traffic. Need deterministic reproduction and displacement profiling. |
| Event cleanup/overlap/seed/manual weather/Low-preset logic | **VERIFIED for tested paths**, with unit and scripted Game evidence; no long interactive event-tour drive. |
| Visual/performance budget on browser | **PARTIAL** matched 37 scenes unchanged and 9/9 stress; live event frame cadence and Android GPU unmeasured. |
| Full existing test pipeline | **PARTIAL** relevant browser suites passed; Android pipeline failed before test discovery. |
| APK / physical Android performance | **BLOCKED** official SDK/JDK/ADB missing; no device test. |
| Continuous 5–10-minute live drive, georeferenced landmark survey, true photo/construction/roadblock events | **NOT TESTED / NOT IMPLEMENTED**, as specified above. |

**Next work:** use a georeferenced Mohammadpur map/on-location references to verify named placements; design a genuine optional, interactable market/passenger decision loop and owning slot IDs for safe road-edge props; reproduce the traffic/race stall deterministically without rewriting NPC AI blindly; rerun all suites after those changes; fix Android pipeline discovery in a dedicated packaging task and profile on a real device.
