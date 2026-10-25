# Changelog

All notable changes to this project. This file records what was actually built.

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
