# Dhaka-first gameplay continuation — partial, tested pass

**Result: PARTIAL, not a completion signoff.** This is the continuation of [`DHAKA_FIRST_GAMEPLAY_PASS_REPORT.md`](DHAKA_FIRST_GAMEPLAY_PASS_REPORT.md), not a replacement for its research and map audit. The previous source/uncertainty record remains in [`DHAKA_REALITY_NOTES.md`](DHAKA_REALITY_NOTES.md); the authored-graph eligibility audit remains in [`DHAKA_FIRST_MAP_AND_EVENTS.md`](DHAKA_FIRST_MAP_AND_EVENTS.md). No new real-world coordinates or surveyed landmarks were asserted. The game still needs deeper police, race, street-life, and multi-system interaction work.

## Implemented interactions

| Area | Result and boundary |
|---|---|
| **VERIFIED (tested scope):** temporary roadworks | On eligible wide, public, forward authored segments in dry daytime free roam, the director now attempts an exact-segment, pooled, passable construction barrier. Failed realization does not announce an event or consume its cooldown. A unique owner links cleanup to that event; it does not clear unrelated barriers. No permanent construction or altered road graph. |
| **PARTIAL:** checkpoint | Heat-gated public-road event reuses that same owned, physical pooled barrier, with bounded TTL and mission/race cleanup. It **does not** introduce a police officer, stop-and-search procedure, fine, or invented checkpoint landmark. Existing police pursuit remains independent. |
| **VERIFIED (tested scope):** market-edge slowdown | A jam-prone authored connector can briefly stop an **existing** eligible commercial NPC for 4.5 s; nearby existing non-reserved sidewalk walkers may pause briefly (at most three), without adding actors or moving reserved passenger pedestrians. Existing traffic congestion/route cost rises and decays. If no eligible NPC exists, this is only a short road-conditions cue; never claim a vehicle appeared. |
| **VERIFIED (tested scope):** meaningful detour | The existing jam-aware route must remain valid while the player drives at least 35 m over at least 8 s without sidewalk travel, impacts or recovery. Route selection alone, debug teleport, or a single large simulation step cannot collect the one-time reward. No new unverified alley or shortcut was drawn. |
| **VERIFIED (tested scope):** rainy passenger care | Existing shopper/elder passenger requests can ask for a careful rain trip. The bounded 12-taka component requires rain, mood ≥75, no ride impacts, and at most one hard brake; market care also requires a safe ride. Existing negotiated roadside flat fares are protected. This is a contextual fare choice through riding behavior, not a new dialogue tree. |
| **VERIFIED (tested scope):** dangerous close pass | A high-speed near miss now gives a localized safety warning on an eight-second cooldown rather than free Turbo. Existing impact logic elsewhere was not redesigned. |
| **VERIFIED (tested scope):** weather/rival/race protection | Existing Auto-weather cue may set storm; manual-weather preference is respected. Director events do not start during missions, races, road rage or police pursuit; entering a duty mission removes a checkpoint. Free-roam rival encounters remain the existing system and are not falsely announced as a newly built event. |

The director retains its 90-second opening/major cooldown, 120-second per-kind cooldown, two-event cap, 38 m zone separation, DRMC gate/campus keep-clear, and authored-site filtering. Construction/checkpoints require forward heading and minimum road width and reject unsafe spawns; no general-world random prop placement was added. Current novelty is limited: no physical broken-down-car event, vendor blockage, player-controlled photo, deep police interaction or new race format. No active-race contact-nudge, eight authored potholes, traffic-turn AI or renderer/preset redesign was attempted. No save-schema or Android identity/version migration.

## Production and deterministic test locations

`src/events/eventDirector.ts`, `src/game.ts`, `src/ai/roadblocks.ts`, `src/ai/traffic.ts`, `src/ai/pedestrians.ts`, `src/gameplay/roadDecisions.ts`, `src/missions/mission.ts`, `src/missions/missionSystem.ts`, and `src/core/i18n.ts` contain the scoped implementation. `tests/unit/dhaka-living-roadwork.test.ts`, `dhaka-market-loading.test.ts`, `dhaka-road-decisions.test.ts`, and existing director tests cover spawn eligibility, ownership/cleanup, existing-agent stop and release, nearby pedestrian pause, driven qualification, care bonus and warning predicate. `tests/e2e/dhaka-first-events.mjs` uses a real Game instance, controlled debug teleports and event forcing for reproducibility. This is **not** a human keyboard drive through every event.

The final live fixture reports market multiplier **3.7**, existing-NPC dwell **4.5 s**, storm, construction and checkpoint ownership, a duty mission clearing an active checkpoint, and a rainy ride with the **12-taka** care component and one completed ride. Twelve repeated construction spawn/render/despawn cycles left geometries **279 → 279**, textures **19 → 19**, programs **65 → 65**, roadblock children **6 → 6**, zero active owned slots/director events and **0 GL errors**. It did **not** separately observe a pedestrian pause in the real-Game trace; that reaction is unit-tested and reached via the market-stop callback. The full data and a test-only-camera roadwork image are in `artifacts/dhaka-first-continuation/live-events.json` and `live-roadwork.png`. Camera placement is for evidence, not a gameplay camera change.

A keyboard-driven DRMC route reached its destination with **0 hits / 0 recoveries** in `live-drmc.log`. A keyboard-driven four-checkpoint race reached all gates with **0 recoveries** and finished in **79.5 s**, but **lost** to a rival at **67.3 s** (`live-race.log`); this is not a race-win proof or proof that all traffic pinning is solved. The first historical race timed out, so race fairness remains PARTIAL.

## Regressions and visuals

| Run | Outcome |
|---|---|
| `npm run build` after the final pedestrian edit (`build-ped.log`) | PASS, includes TypeScript typecheck. |
| `npm test` (`unit-final-ped.log`) | **38/38 files, 238/238 tests passed** after the final edit. |
| `npm run test:e2e`, `npm run test:mobile`, `npm run test:ui` (`*-final-ped.log`) | **21/21**, **13/13**, **33/33** passed after the final edit; mobile means browser mobile-UI checks, not Android device. |
| `npm run test:vnext-repair`, `npm run test:vnext` (`*-final.log`) | **9 PASS lines**, **9/9** after the final edit. |
| `npm run test:spec`, `npm run test:upgrade`, `npm run test:v05` (`spec.log`, `upgrade.log`, `v05.log`) | **12/12**, **17/17**, **13/13** earlier in this continuation; not rerun after the last pedestrian reaction edit. |
| Scripted real-Game fixture (`live-events-ped.log`) | PASS after the final edit; controlled teleports, not a driven event-tour. |
| `node tests/e2e/stress-v2-benchmark.mjs` (`stress.json`, `stress.log`) | **9/9** simulated-stress checks earlier in this continuation; simulated 15-minute session, **not** a continuous real-time drive or Android GPU profile. |
| `python3 scripts/build-apk.py --check` (`android-check.log`) | **BLOCKED:** Android SDK not configured. No APK, install, emulator run or physical-device measurement. |

[`artifacts/dhaka-first-continuation-manifest.json`](../artifacts/dhaka-first-continuation-manifest.json) identifies **37 before + 37 after** matched-condition scene images and per-scene metrics. The before set is an untouched copy of the previous partial pass's post-change images made **before this continuation's production edits**; the after set was recaptured **after the final pedestrian edit**. Conditions include fixed 960×540/DPR1 Chromium/SwiftShader, seeded city, weather/hour/preset/camera, road, commercial, residential, DRMC exterior, rain/night, cars/LOD and potholes. Both scene sets have **zero captured diagnostics**. Inspected commercial Balanced before/after: visual scene unchanged, as expected for logic-only events. Commercial Balanced calls **127 → 127**, triangles **451,275 → 451,275**; DRMC exterior **73 → 73**, **308,599 → 308,599**. The static fixture freezes ambient agents and **cannot demonstrate actual event activity**; the live roadwork screenshot has no pre-event pixel-matched partner. HUD camera-state mismatch is explicitly marked non-pixel-matched in the manifest. SwiftShader render walls and simulated stress are **not Android FPS**. Ignored local screenshot/log artifacts may not survive workspace resets.

## Open classifications and next work

| Criterion | Status | Why / next evidence |
|---|---|---|
| Authored geography, campus gate protection, event cooldown/cleanup | **VERIFIED within deterministic tests and live fixture** | Still not a ground survey of Mohammadpur. |
| Dynamic traffic incident and NPC/roadside reaction | **PARTIAL** | Existing commercial stop and nearby walker pause tested; no broken vehicle, vendor interaction or broad pedestrian choreography; no claim of a spawned accident. |
| Contextual passenger request and risk/reward | **PARTIAL** | Careful-rain reward and dangerous-near-miss warning tested; other pre-existing score/destruction incentives not audited end to end. |
| Meaningful shortcuts and route interaction | **PARTIAL** | Driven alternative-path qualification tested; no new shortcut geometry, route-signage choice UI or large live A/B traffic trial. |
| Police checkpoint | **PARTIAL** | Owned barrier tested; no officer, stop procedure or penalty. |
| Free-roam rival encounter/race variety | **PARTIAL** | Existing rival system safeguarded; live race completed but lost. No new race variants or repeated balanced-opponent trial. |
| Weather-driven event | **PARTIAL** | Auto storm cue and rain-care reward tested, but no naturally driven multi-event weather session. |
| Local roadside activity | **PARTIAL** | Existing walker and commercial-vehicle responses; broader market art, dialogue and stalls not newly authored. |
| Cross-system cleanup, browser regressions and render-resource lifecycle | **VERIFIED for tested paths** | Mission/checkpoint, rain/passenger, jam/detour and 12-cycle resource results above; not exhaustive concurrency fuzzing. |
| Real-world coordinate/landmark verification | **NOT TESTED** | Existing OSM-derived game graph is authority; no fresh field/OSM positional confirmation. |
| Android build/install/device FPS, battery, thermals | **BLOCKED** | Official SDK/toolchain/device unavailable. Preserve `com.shostalab.banglartesla`, minSdk 24, versionCode 7, versionName 0.6.0; no fabricated APK or unofficial aapt2. |

**Next:** isolate and reproduce the race traffic-pin/deadline case before touching the completed NPC AI; design a genuine officer/stop procedure only if it fits the map, police rules and player agency; add more locally grounded ambient activities and interactions without saturating the road; test naturally driven mixed-event sessions and mission/rival balance; configure the official Android SDK/JDK/ADB and profile a real device. The earlier first-pass document remains a historical partial result, not a claim that this continuation is finished.

Git safety: all work stayed on `arena/1cbc19eb-banglar-tesla`; no reset, clean, branch change, staging, commit, push or PR. Existing dirty work was retained. The live fixture refreshed its hard-coded historical **ignored** `artifacts/dhaka-first-pass/live-director.json` and `live-roadwork.png` before task copies were saved; no promise that every ignored historical artifact was untouched. The older stress JSON was backed up and restored. See the final worktree check accompanying this report for exact modified/untracked counts.
