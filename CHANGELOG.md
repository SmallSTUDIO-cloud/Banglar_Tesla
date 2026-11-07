# Changelog

All notable changes to this project. This file records what was actually built.

> **Documentation note.** This file was only maintained for `0.1.0`. The entries
> from `0.2.0` to `0.6.3` were reconstructed from the actual git commit messages
> of the tagged release commits on `main`, because no release notes were written
> at the time. Each entry names its commit. Where a commit message is terse, the
> entry stays terse rather than inventing detail. Version numbers `0.6.4`,
> `0.6.5` and `0.6.6` were never tagged and never released.

## [0.6.7] — 2026-11-05 — `8379f25` (tag `v0.6.7`)

Debug-signed test APK. Package `com.shostalab.banglartesla`, versionCode 11,
versionName 0.6.7, minSdk 24. APK 13,546,101 bytes, SHA-256
`e0b4901f127205ca6d2d79fff8761257e6bd306163c791d7ce8ef275c46c4cff`.

* Dense grocery frontages, mudi dokans and user-supplied education posters,
  packed into a WebP atlas; no per-shop draw calls or new colliders.
* Camera anti-clipping rewritten from a full collider scan per frame to a 16 m
  spatial-cell index. A same-page 4,000-point query microbenchmark measured
  102.6 ms (full scan) against 4.3 ms (indexed), 432 hits either way.
* Measured *synthetic* scene cost: Balanced 174 draw calls / 971,989 triangles;
  Low 130 / 570,181.
* **Not claimed:** any device frame rate, any real-phone behaviour. All numbers
  come from headless SwiftShader. See `docs/STREET_DENSITY_PERFORMANCE_PASS.md`.

## [0.6.3] — 2026-11-01 — `6aec0e6` (tag `v0.6.3-test.1-20261101`)

* Street visuals, safe overtakes and ranked progression for the test APK.

## [0.6.2-test.1] — 2026-10-31 — `374a69d` (tag `v0.6.2-test.1-20261031`)

* Optimized Dhaka street feel, packaged as a separate Android test build.

## [0.6.1-test.1] — 2026-10-31 — `7fbcbd4` (tag `v0.6.1-test.1-20261031`)

* Complete Mohammadpur feature pass.

## [0.6.0] — 2026-10-27 — `865b5a6` (tag `v0.6.0`)

* Master Upgrade vNext: Bangla voice gate, five-state weather, DRMC landmark,
  scrapbook, and character-rig integrity.

## [0.5.1] — 2026-10-26 — `b68a081` (tag `v0.5.1`)

* Master Upgrade v4: Race-Map design, 4-Rickshaw Race, Winner Photo, plus
  character, NPC and graphics passes.
* CI: the Android APK workflow was widened from one pinned session branch to all
  `arena/*` branches.

## [0.5.0] — 2026-10-25 — `056d7c6` (tag `v0.5.0`)

* Rickshaw Blacklist progression, hold-to-boost Turbo, 5-Heat Police Pursuit,
  OBB physics and a Dynamic Clock.

## [0.4.0] — 2026-10-25 — `6314a17` (tag `v0.4.0`)

* Dhaka audio soundscape, Bangla road rage, breakables and the টান boost.

## [0.3.0] — 2026-10-25 — `d4b4245` (tag `v0.3.0-android-test`)

* Mobile performance: instanced traffic fleet, baked ambient occlusion and shader
  prewarm, shipped with the v0.3.0 APK.
* Added the GitHub Pages deployment for the web game.

## [0.2.0] — 2026-10-24 — `9cbdf99` (tag `v0.2.0-android-test`)

* Mohammadpur overhaul: reworked steering, a 7-mode camera, OSM-derived streets,
  the electric rickshaw, Dokan shopfronts and a performance pass.

## [0.1.0] — 2026-10-23 — Phase 1 vertical slice

### Added — engine & shell
* Vite + TypeScript + three.js r186 project with strict type checking, zero runtime deps beyond three.
* Boot splash with an original wheel/floral emblem, skippable, auto-dismiss.
* Game shell (`src/game.ts`): renderer, single frame loop, fixed-step physics, mode lifecycle
  (menu / duty / free / daily), pause semantics, orientation + visibility handling.
* PWA: manifest (bn/en names, maskable icons), service worker offline cache, fullscreen + landscape.

### Added — world
* Hand-authored Old-Dhaka-inspired district: main road, cross road, two lanes, two shopping
  `gali`, junctions with zebra crossings, speed humps, kerbs, sidewalk strips and aprons.
* Procedural textures (no external images): asphalt with patches/cracks, plaster with damp
  streaks, brick, shop shutters, pavement slabs, awning stripes, cloth weave, river water,
  road paint, posters, sign atlas.
* Modular building kit: shopfronts with recessed interiors and shutters, framed sign boards,
  awnings, balconies with railings and laundry, AC units, drain pipes, roof tanks, stair heads.
* 16 fictional Bangla shop signs rendered with real Bangla text into a single atlas.
* Street props: tea stall (kettle, cups, bunting, bench), fruit cart with umbrella, crate stacks,
  tyre piles, construction barriers, bins, benches, rickshaw stand with parked rickshaws, posters.
* Power poles with sagging catenary wires; riverfront edge with steps, water plane and moored boats.
* Environment system: shader sky, sun with shadows, fog, five day phases, three weather states,
  streaking rain, wet-road darkening/sheen, street lamp pools, night shop/window glow.

### Added — vehicle
* Procedural cycle rickshaw: spoked wheels, mudguards, fork, handlebar, bell, headlamp, saddle,
  framed bench with stitched upholstery, canopy with wooden bows, valance, nine tassels,
  mirrors, plastic flowers, ঢাকা plate, and hand-painted rear-panel art in four motifs.
* Animation rig: speed-matched wheel spin, steering, two-bone pedalling rider, canopy sway,
  tassel motion from lateral acceleration.
* Custom driving simulator: progressive acceleration with falloff, rolling drag, braking with
  full stop, deliberate reverse, bicycle-model steering with speed-dependent limits, circle-vs-AABB
  collision resolution, hump pitch/roll, stuck detection, surface-dependent grip.
* Chase camera: exponential follow, look-ahead, spring-arm occlusion pull-in, trauma shake,
  mild speed FOV, chase/close modes.

### Added — city life
* Traffic routes with left-hand lane offsets and rounded corners; 6 vehicle types with original
  low-poly models and fictional liveries; car-following, player blocking, signal cycles with lamp
  heads, honks with distance panning, brake lights, distance culling.
* Instanced pedestrians on sidewalk paths with pauses, step-aside reactions and a walk cycle.

### Added — gameplay
* Seeded mission generator (pickup/drop, road distance, target time, optional request, fare estimate).
* Passenger actors with walk/board/sit/leave animation, six archetypes, Bangla dialogue bubbles.
* Pickup and drop-off only inside zones and only when nearly stopped; mood reacts to impacts,
  hard braking and lateness; boarding fallback if a walk is blocked.
* Fare breakdown: base + distance + on-time + smoothness + tip − damage, with star rating and
  meme-style stamps on good rides; daily challenge multiplier.
* Three modes: Passenger Duty, Free Ride, offline Challenge of the Day (date-seeded).
* Economy: ৳500 starter, transparent payouts, guarded spending, repair quotes, cosmetics.
* Garage showroom: turntable with drag-to-rotate, stats, repair, paint/art/tassels/bells/flowers/
  mirrors tabs, vehicle purchase and selection, Cassette Box track picker.
* Store, credits, pause, tutorial (4 steps), result screen, job-offer card, toasts, contextual HUD hints.
* Save system v2: migration, sanitisation, `.bak` backup, corrupt-file recovery, throttled autosave,
  spawn/settings persistence.

### Added — audio
* Runtime-synthesised audio engine with six buses + limiter; three original music loops
  (*Cassette Dhaka*, *Rickshaw Radio*, *Brishti at Dusk*); bell variants, drivetrain hum, tyres,
  impacts, brake squeal, coins, UI taps, stingers, distant horns, crows, tea clinks, rain, crowd.

### Added — settings & accessibility
* Quality presets driving render scale, shadows, traffic/pedestrian density, rain budget, lamps,
  reflections; FPS target; audio sliders per bus + mute; analog wheel / buttons steering;
  left-handed layout; sensitivity; dead zone; camera shake; haptics; text size; HUD scale;
  reduce effects; subtitles; Bangla/English switch; reset to defaults.

### Added — quality engineering
* 61 unit tests (fares, stats, guards, save migration/corruption, settings sanitisation,
  driving model, routes, mission determinism, localisation completeness).
* 21-check automated browser E2E run (boot, job offer, board, drive, deliver, payout, garage,
  purchase, settings, language, quality, reload persistence, free ride, pause, zero page errors).
* Visual review passes over menu/HUD/garage/night/rain in landscape and portrait, with fixes for
  menu composition, glyph fallbacks, showroom lighting/framing, lamp coverage, night readability.

### Known gaps
* No native APK/AAB (no Android SDK/JDK/Godot in the build sandbox).
* Single district; traffic is route-based rather than fully emergent; no photo mode.
