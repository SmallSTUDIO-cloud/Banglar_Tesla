# Banglar Tesla — Unity production migration plan

**Status:** implementation plan and acceptance contract, not a claim of completed migration.

**Target:** Unity 6.3 LTS-era project, C#, Universal Render Pipeline (URP), native Android and Unity Web.

**Feature baseline:** released web/Android source at `origin/main` commit `619a7743ecca092ef671d1df17b401eaa791d69b` (v0.6.7).
**Branch:** `arena/f78d620e-banglar-tesla` only.

## 1. Non-negotiable requirements

1. Keep the released Three.js game available while Unity is incomplete. Do not replace its working web or APK release with an unverified migration.
2. Preserve the complete v0.6.7 feature set: driving, vehicles/upgrades/cosmetics, passenger and cargo jobs, economy, garage/store, save migrations, settings, localization, audio, dynamic time/weather, traffic, pedestrians, collisions/destruction, police/road rage, road decisions, daily/event content, Blacklist rivals/races/cinematics/scrapbook, cameras/mirrors/showroom and accessibility.
3. Use new Unity/C#/URP runtime code under `unity/`; do not claim that a JavaScript wrapper or design mockup is the Unity game.
4. Design original reusable UI assets and interactions. Preserve Bengali/English text and simultaneous multi-touch driving.
5. Derive the Mohammadpur road network from identified geographic sources. Never label inferred geometry, road widths or procedural buildings as surveyed fact.
6. Put visible roadblocks at boundary road exits and enforce a continuous gameplay boundary so a player cannot drive around a barricade and escape the playable district.
7. Design for stable frame times on the Samsung Galaxy M21 low-quality profile, not only average desktop FPS. Retain explicit population/rendering budgets and test long sessions.
8. No production release, website replacement or claim of full parity until the gates in §10 pass. Debug builds must remain labeled as such.

## 2. Unity research: discovery, selection and provenance

GitHub stars were used for discovery on 2026-11-06, not as proof of quality or compatibility. Highly starred but irrelevant projects (ML-Agents, Netcode, extraction/reverse-engineering tools, multiplayer frameworks and Godot/Roblox agent skills) are excluded. No third-party framework is being added merely because it is popular.

| Repository | Observed stars | Reviewed revision | Relevant lesson / decision |
| --- | ---: | --- | --- |
| `Unity-Technologies/EntityComponentSystemSamples` | 8,213 | discovery only | Data-oriented design is useful, but DOTS is not automatically the right web/mobile migration. Start with testable managed simulation and profiling. |
| `Unity-Technologies/NavMeshComponents` | 3,087 | `41d24c4639f3196905f547cb0148e4f44c2d2b7d` | The repository directs current Unity versions to the AI Navigation package. Use supported package APIs rather than copying the archived components. |
| `Unity-Technologies/Graphics` | 3,023 | `0efc28ea742b1966b9dd9cc4489e58b986a13faf` | Use the URP package matching the editor, not an unreleased master branch or HDRP. Keep renderer configuration platform-specific. |
| `SebLague/Path-Creator` | 2,102 | `619c4c39d8a5a5d85914cc4c315121c288c32327` | Path sampling is relevant; the geographic road graph only needs bounded polylines/arcs, so avoid another dependency. MIT if code is ever reused. |
| `Unity-Technologies/game-programming-patterns-demo` | 1,740 | `edbd64fd5635e567d99cf0cfd4f2f7f37ef9dc97` | Apply state, observer, command, pooling and separation-of-concerns selectively. Its README explicitly says patterns are examples, not promises. No unlicensed code copying. |
| `Unity-Technologies/InputSystem` | 1,526 | `54b1581acb600c1f00998505af19a644795ef9b8` | Use released Input System packages and explicit action maps. Review on-screen controls, rebinding and UI-versus-game input. The public repository is now maintenance-mode for newer Unity development. |
| `Unity-Technologies/BagelGame` | 57 | `5d0348bfa013f3c76299dd582c90a7549f66abce` | Lower-star but highly relevant official Unity 6.3 LTS vertical sample: UI Toolkit, Input System and data flow. Study patterns; do not copy its game or assets. |

License handling: Unity packages remain under their package licenses. MIT license notices must accompany any reused MIT code. Repositories without a clearly identified license are read for concepts only. Original Banglar Tesla code/assets and existing asset credits remain documented in `ASSET_CREDITS.md` and the Unity asset manifest.

## 3. Architecture

```text
unity/
  Assets/BanglarTesla/
    Runtime/
      Domain/          Pure C# deterministic simulation and data; no scene singletons
      Application/     Use-case orchestration, save/settings/session services
      Infrastructure/  Unity storage, audio, input, time and platform adapters
      Presentation/    UI Toolkit presenters, HUD customization, menu/garage/race UI
      World/           Geographic import, chunk building, LOD/culling, visual actors
      Vehicles/        Rickshaw controller, cameras, mirrors and appearance
    Data/              Versioned catalogs, map manifest, localization and source metadata
    Art/               Original procedural meshes, materials and UI icons
    Audio/             Licensed existing audio plus migration manifest
    Tests/             EditMode/PlayMode parity, layout and performance tests
  Packages/            Locked Unity package dependencies
  ProjectSettings/     URP, Android, Web, quality, color space and project identity
  Design/              Editable UI/UX specifications; never a substitute for runtime UI
```

Rules:

- Fixed-step simulation is independent of frame rate. Presentation interpolates and never owns gameplay truth.
- Feature systems have explicit state machines and interfaces; no global `Update()` chain with hidden ordering.
- Runtime catalogs are data-driven, validated at load and covered by tests.
- Old save JSON is migrated once into a versioned Unity save, retaining taka, vehicles, upgrades, cosmetics, settings, race progress and scrapbook records where the old schema contains them.
- Browser storage, Android storage and audio/TTS are adapters behind the same application interfaces.

## 4. HUD/UI redesign from the supplied screenshot

### Problems to solve

- The right side mixes map, money, reputation, stamina, turbo, speed, brake and pedal in competing visual weights.
- Steering is isolated at the opposite bottom corner without a clear control-group identity.
- Small utility buttons have similar emphasis to primary driving controls.
- Safe-area, hand reach, localization expansion and user preference need first-class handling.

### New layout

- **Left thumb:** one steering dock with large left/right targets, clear pressed state and optional tilt/wheel mode.
- **Right thumb:** large pedal primary action; brake offset inward; turbo above with a charge ring; horn as a smaller nearby action.
- **Information:** compact mission card at top-left; currency/condition/status in a slim top strip; minimap separated from the pedal cluster; pause/camera/race utilities kept small.
- **Visual language:** original rickshaw-bell and road-sign motifs, deep tea-green translucent surfaces, warm brass primary accents, red brake, cyan electric charge, high-contrast icons and Bengali labels. Avoid copying another game's HUD.
- **Accessibility:** minimum logical touch target, scale and opacity controls, reduced motion, high contrast, left-handed mirror preset and Bengali font assets with license notices.

### Control customization

A Settings → Controls → Customize mode provides:

- Drag handles with grid snapping and safe-area clamping.
- Global button scale plus selected-control scale.
- Opacity adjustment, left-handed preset and reset-to-default.
- Versioned per-control normalized positions saved across reloads.
- Multi-touch pointer ownership so dragging/editing cannot leave pedal, brake or steering stuck.
- PlayMode checks for 16:9, 19.5:9, 20:9, tablet, display cutouts and rotated devices.

## 5. Geographic source and map contract

### Evidence located

- OpenStreetMap way `318722840` identifies a Mohammadpur Thana boundary; its API response includes ODbL attribution.
- OSM has named features including `Tajmahal Road`, `Mohammadpur Town Hall Market` (way `223068917`) and `Mohammadpur Agricultural Kacha Bazar` (way `367368960`).
- RAJUK's Integrated Detailed Area Plan (2022–2035) search result includes `Chandmia Housing`, `Tajmohal/Tajmahal Road`, Road No. 02 and other local labels. It is a secondary cross-check, not yet georeferenced source geometry.

### Import policy

1. Pin the source URL, retrieval time, bbox, OSM element IDs and content checksum in a manifest.
2. Import all OSM highway centerlines in the verified district bbox, preserving `name`, `name:bn`, class, one-way, lanes, surface and explicit width tags when present.
3. Project longitude/latitude to metres around a documented local origin. Keep source coordinates for audits and minimap display.
4. Preserve shared OSM node IDs as graph junctions; do not invent disconnected intersections.
5. If `width` is absent, a road-class fallback may be used for a playable preview but **must be labeled estimated**. Exact road widths require surveyed or otherwise authoritative data.
6. Landmark positions may come from OSM/RAJUK evidence. Detailed 3D facades require separate visual references; generic procedural infill is never presented as an exact real building.
7. Detect road/boundary intersections for visible barricades. A continuous boundary constraint handles off-road escape attempts.
8. Retain an import validation report listing missing names, widths, disconnected components, duplicate IDs and unverified landmarks.

The phrase “exact full map” is accepted only when its geometry and widths pass source validation. OSM is crowdsourced and RAJUK maps can use different spellings; neither justifies claiming real-world perfection.

## 6. Optimization design

- Chunk static world geometry by district cell and material; no per-packet/per-window GameObjects.
- LOD0/1/2 for buildings, vehicles, rickshaw detail and vegetation; screen-relative transitions with hysteresis.
- Unity frustum culling through correct renderer bounds, plus distance-band simulation for offscreen agents.
- Fixed-size pools for traffic, pedestrians, debris, rain and audio voices; no spawn/despawn churn in the driving loop.
- Shared materials, GPU-resident meshes where Web supports them, static batching and measured SRP batching compatibility.
- No per-frame LINQ, reflection, string formatting or temporary arrays in hot paths.
- Stagger noncritical AI updates; preserve near-player collision and control fidelity.
- Quality profiles control render scale, shadow distance/resolution, LOD bias, population and effects independently.
- Warm shaders and preload recurring audio before first use; instrument loading and first-use spikes.
- Avoid aggressive settings that break Web, pop visible geometry into view, disable near-player collision or reduce gameplay correctness.

Initial gates (subject to device profiling, not fabricated results):

| Profile | Target | Population | Rendering policy |
| --- | --- | --- | --- |
| M21 Low | stable 30 fps, investigate p95/p99 spikes | existing low caps or lower only after review | reduced render scale/shadows/effects, aggressive but correct LOD |
| Balanced | stable 30/60 according to device | existing balanced caps | moderate shadows and view distance |
| High/Desktop | visual quality | existing high/PC caps | increased LOD range, not unbounded density |

## 7. Feature-parity matrix

| Domain | Required Unity coverage |
| --- | --- |
| Driving | pedal/electric/roadster physics, reverse, wet grip, brake/boost/stamina/battery/turbo, collisions/condition/recovery |
| Cameras | chase/close/wide/low/front/cockpit/side, collision avoidance, mirrors, showroom/winner photo |
| Jobs | passenger/cargo generation, pickup/board/drop-off, route/deadline/mood/dialogue, fares/bonuses/penalties |
| Economy | taka, vehicles, upgrade levels, cosmetics, repair, store, garage appearance and stats |
| World | geographic roads, junctions, sidewalks, markets, landmarks, props, trees, poles/wires, posters, potholes/destruction |
| AI | left-hand traffic, junctions/signals/yield/overtake, pothole response, pedestrian schedules/reactions/roadside loading |
| Consequences | road rage dialogue/settlement/scuffle, police detection/pursuit/intercept/cooldown, roadblocks |
| Blacklist | all ten rivals, event requirements, ranked and optional races, routes/checkpoints/deadlines/rewards, intro/retry/escape |
| Career | REP, milestones, daily/event director, scrapbook and winner records |
| Presentation | Bengali/English, menu/HUD/pause/settings/credits/tutorial, audio scenes/tracks/ambience/dialogue/TTS fallback |
| Persistence | settings and progress sanitization, old-save migration, backup/corrupt recovery, customization layout persistence |
| Accessibility | scale/opacity/handedness/control repositioning, reduced motion, camera shake, haptics, volume and graphics options |

Every matrix row requires both an implementation reference and verification evidence before it can be marked complete.

## 8. Migration stages

1. **Baseline and contracts:** merge the released source into this branch, inventory schemas/catalogs, create Unity solution/project and CI guards.
2. **Geographic foundation:** source import, projection/graph validation, road meshes, landmarks registry and boundary blocks.
3. **Playable vertical slice:** rickshaw/controller/cameras, one passenger job, HUD and customizable controls on the real road graph.
4. **Core production systems:** economy/garage/store/save/settings/localization/audio and world streaming.
5. **Remaining gameplay:** full missions/events, traffic/pedestrians, police/road rage/destruction, Blacklist/races/scrapbook.
6. **Visual content:** original procedural rickshaw/vehicles/people/buildings/landmark dressing, licensed poster/audio/font migration, URP profiles.
7. **Parity and optimization:** automated domain/UI/PlayMode tests, long-session profiling, Web/Android builds and M21 measurements.
8. **Release decision:** only after parity and platform gates; separately authorize production signing, version and website replacement.

## 9. Validation strategy

- Pure C# domain tests run without the editor on .NET CI.
- Unity EditMode tests validate imports, catalogs, map graph, URP assets and scene construction.
- Unity PlayMode tests validate multi-touch release/cancel, safe-area layout, driving, jobs, race progress, save/load and culling correctness.
- Web and Android CI must use the same commit and preserve artifacts/checksums.
- Existing TypeScript tests remain as baseline evidence; they are not evidence that the Unity rewrite works.
- Physical M21 tests cover low graphics in market, rain, night, race/pursuit and a sustained drive, including p95/p99 frame-time spikes, memory and thermals.

## 10. Definition of done

The migration is complete only when:

- Every feature matrix row is implemented and linked to a passing Unity test or an explicitly documented platform validation.
- Map provenance is complete, the entire imported road graph is connected as expected, boundary exits are blocked, and estimated versus verified data is visible in the audit.
- No known severity-1/2 gameplay, save, input, localization or platform defects remain.
- Web and Android release candidates are built from the same reviewed commit and actually launched.
- M21 low-profile frame-time results are recorded; no claim of stable performance is made from desktop/browser emulation alone.
- Bengali rendering, audio, offline behavior and save migration are checked on both targets.
- Production signing, version code/name and deployment are separately reviewed.

Until then, reports must say **migration in progress** and enumerate missing systems rather than calling the project a bug-free 1:1 rewrite.
