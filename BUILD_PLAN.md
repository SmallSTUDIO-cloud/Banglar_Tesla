# BUILD_PLAN — Banglar Tesla

Living plan. Each milestone lists measurable acceptance criteria and its real status.
No milestone is marked done unless it was run and verified.

## Environment facts (recorded before building)

| Item | Result |
|---|---|
| Workspace on start | empty except `README.md` and one commit |
| Node / npm | v22.22.3 / 10.9.8 |
| Godot editor | **not installed** |
| Godot release download | **blocked** (`release-assets.githubusercontent.com` unreachable from this sandbox) |
| Export templates | none |
| JDK / Android SDK / Gradle / adb | **not installed** |
| Browsers | none preinstalled; a software-rendered Chromium (`@sparticuz/chromium` + SwiftShader) was installed for automated visual/E2E testing |
| Python | 3.11 with Pillow/numpy (used to generate icons and inspect screenshots) |

Decision recorded: build a **three.js + TypeScript** vertical slice, which the skill router
supports and which can be *actually run and verified* here. Godot/APK path documented honestly
in `docs/ANDROID_PACKAGING.md`.

---

## Milestone 0 — Foundations

| # | Task | Status |
|---|---|---|
| 0.1 | Project scaffold (Vite + TS, strict mode, no framework) | **DONE** |
| 0.2 | Design tokens, responsive UI base, safe-area handling | **DONE** |
| 0.3 | Localisation layer (bn default + en), 300+ keys, no hard-coded strings in screens | **DONE** |
| 0.4 | Font licence: Hind Siliguri (OFL) shipped locally, Bangla shaping verified in-render | **DONE** |
| 0.5 | Skill-driven engine/task routing recorded (three.js + UI/camera/audio/save/perf skills) | **DONE** |

**Acceptance:** `npm run build` passes with strict TS; Bangla renders correctly (verified by
screenshot); no external network fonts required at runtime. **Met.**

---

## Milestone 1 — The neighbourhood

| # | Task | Status |
|---|---|---|
| 1.1 | Road network data model (main/cross/lane/gali, widths, sidewalks) | **DONE** |
| 1.2 | Procedural asphalt, plaster, brick, shutter, pavement, awning, water, paint textures | **DONE** |
| 1.3 | Merged-geometry building kit with shopfronts, balconies, laundry, AC, tanks | **DONE** |
| 1.4 | Sign atlas with 16 fictional Bangla shop boards; posters; `ধীরে চলুন` boards | **DONE** |
| 1.5 | Street props: tea stall, fruit cart, crates, tyres, barriers, bins, benches, rickshaw stand | **DONE** |
| 1.6 | Speed humps + sidewalk kerbs + zebra crossings + lane dashes | **DONE** |
| 1.7 | Power poles and catenary wires; riverfront edge with boats | **DONE** |
| 1.8 | Day phases (morning/noon/golden/blue/night) + rain + wet roads + street lamps | **DONE** |
| 1.9 | Night shop/window glow layer | **DONE** |

**Acceptance:** a screenshot from the road is unmistakably a dense, colourful South-Asian
commercial street with Bangla signage; no missing ground gaps; ≥30 FPS at Low on software
rendering is *not* required (software renderer), but draw calls stay low (merged mesh families).

---

## Milestone 2 — The rickshaw

| # | Task | Status |
|---|---|---|
| 2.1 | Cycle-rickshaw model: 3 wheels, fork, handlebar, bell, lamp, bench, canopy, rear art | **DONE** |
| 2.2 | Procedural hand-painted rear-panel art (floral/bird/river/cinema) | **DONE** |
| 2.3 | Rig: wheel spin, steering, two-bone pedalling rider, canopy sway, tassels | **DONE** |
| 2.4 | Custom driving model (accel falloff, coast, brake, deliberate reverse, speed-dependent steer) | **DONE** |
| 2.5 | Collision resolution vs. city AABBs, stuck detection, hump response, surface grip | **DONE** |
| 2.6 | Chase camera with spring-arm collision avoidance and trauma shake | **DONE** |
| 2.7 | Upgrades/cosmetics wired into model + physics (tyres, brakes, bearings, steering, seat, canopy, lights) | **DONE** |

**Acceptance:** W/▲ accelerates smoothly to ~27 km/h, coasts to a stop, brakes, reverses only
after a hold; the rickshaw cannot end up inside a wall; unit tests cover all of the above.
**Met (19 tests).**

---

## Milestone 3 — City life

| # | Task | Status |
|---|---|---|
| 3.1 | Traffic route graph with left-hand lane offsets | **DONE** |
| 3.2 | Six vehicle models (bus, car, CNG, motorcycle, rickshaw, truck) with liveries | **DONE** |
| 3.3 | Car-following, player blocking, junction signals, honks, brake lights, culling | **DONE** |
| 3.4 | Instanced pedestrians with sidewalk paths, pauses, avoidance | **DONE** |
| 3.5 | Quality-driven density (6–16 vehicles, 8–26 pedestrians) | **DONE** |

**Acceptance:** traffic circulates on the correct side, stops at red, never drives through the
player, and recycles with distance. **Met (verified visually + in E2E snapshots).**

---

## Milestone 4 — The loop that matters

| # | Task | Status |
|---|---|---|
| 4.1 | Seeded mission generator with pickup/drop-off, distance, target time, optional goal | **DONE** |
| 4.2 | World markers (beacon/ring/arrow) + minimap + distance readouts | **DONE** |
| 4.3 | Passenger actor: walk, board, seated pose, leave; archetypes and dialogue | **DONE** |
| 4.4 | Stop-in-zone pickup, stop-in-zone drop-off, mood, late penalty | **DONE** |
| 4.5 | Fare breakdown screen with stars, bonuses, deductions, next actions | **DONE** |
| 4.6 | Taka economy: starter balance, payouts, spending guards, repairs | **DONE** |
| 4.7 | Garage: stats, repair, paint/art/accessories tabs, vehicle purchase/select, cassette box | **DONE** |
| 4.8 | Store: vehicles, upgrades, paint, accessories with confirmation modals | **DONE** |
| 4.9 | Save/load: versioned JSON, migration, sanitisation, corrupt recovery, autosave | **DONE** |
| 4.10 | Settings: graphics presets, audio buses, controls, language, accessibility — all functional | **DONE** |
| 4.11 | Tutorial (4 short steps), pause, recover rickshaw, return-to-menu confirmation | **DONE** |

**Acceptance (Phase 1 definition of done):** start → accept job → pick up passenger → drive →
deliver → earn taka → buy/equip an item → save → quit → return with progress intact.
**Met and automated** (`tests/e2e/run-e2e.mjs`, 21/21 checks).

---

## Milestone 5 — Audio & presentation

| # | Task | Status |
|---|---|---|
| 5.1 | Synth engine with 6 buses + limiter, volumes persisted | **DONE** |
| 5.2 | Three original music loops + track switching from the Cassette Box | **DONE** |
| 5.3 | Vehicle/ambience/traffic/UI SFX families | **DONE** |
| 5.4 | Rain and crowd beds tied to weather/density | **DONE** |
| 5.5 | Logo sting, menu hero framing, result screen stamps, toasts | **DONE** |

**Acceptance:** music does not stack after scene changes (single scheduler, look-ahead queue),
muting works per bus, audio survives pause (suspends with the app). **Met.**

---

## Milestone 6 — Shipping readiness

| # | Task | Status |
|---|---|---|
| 6.1 | PWA manifest, icons (any + maskable), theme colour, fullscreen, landscape | **DONE** |
| 6.2 | Service worker offline cache (production builds only) | **DONE** |
| 6.3 | Unit tests (61) + E2E tests (21) + UI click-through tests (17) + visual review passes | **DONE** |
| 6.4 | README / BUILD_PLAN / CHANGELOG / ASSET_CREDITS / TEST_REPORT / KNOWN_ISSUES / ROADMAP | **DONE** |
| 6.5 | Native APK/AAB | **NOT DONE** — no SDK/JDK/Godot in the sandbox; documented route in `docs/ANDROID_PACKAGING.md` |
| 6.6 | Device-tier profiling on real phones | **NOT DONE** — no devices available here; budgets + fallback implemented instead |

---

## Phase 2+ (not started, prioritised in `docs/CONTENT_ROADMAP.md`)

More passenger personalities and written dialogue; festival/market street events; delivery
missions (fragile cargo); a second district (riverfront) connected through a hub; photo mode;
multiple rickshaw models with unique art sets; achievements screen; local challenge records.
