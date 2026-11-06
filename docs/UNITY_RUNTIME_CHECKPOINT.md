# Unity runtime checkpoint — 2026-11-06

**Status: migration in progress. This is source for a playable vertical-slice foundation, not a completed 1:1 rewrite or a verified Unity build.**

## Implemented in this checkpoint

- A single `GameBootstrap` composition root loads the sourced map, career/settings storage, fixed-step rickshaw dynamics, HUD, camera and lighting.
- `SourcedMapWorld` renders OSM-derived road centerlines in 256 m/material chunks with shared URP materials and renderer bounds suitable for Unity frustum culling.
- Road-exit barricades use two combined render meshes and OBB gameplay colliders. A continuous district boundary remains a separate escape-prevention constraint.
- The default spawn snaps the sourced Mohammadpur Bus Stand position (OSM node `3712961702`) to the imported driveable graph. A saved spawn is restored only when finite and inside the boundary.
- `RoadGraph.FindNearest` uses a road-AABB spatial index with deduplicated queries and an exact global fallback. The real-map test compares it to the original exhaustive segment search, including far-away queries.
- Recovery is distinct from full dynamics reset and preserves odometer, battery, stamina, turbo charge and session hit counters.
- The UI Toolkit HUD has original icons, safe-area-aware controls, independent pointer holds and an accessible customization entry for global/per-control scale, opacity, handedness, dragging and reset.
- Keyboard/gamepad input, seven camera modes, PlayerPrefs/Android storage and direct WebGL `localStorage` migration adapters are wired into the shell.

## Evidence and accuracy limits

- Offline importer/minimap tests: **6/6 passing** locally.
- The generated map contains **1,610 roads**, **2,857 named POIs** and **129 driveable boundary crossings**. Only **3** roads have explicit OSM widths; the other widths are labeled lane/road-class estimates.
- Road geometry and named positions retain OSM provenance under ODbL. They are not independent ground truth or surveyed exactness.
- Barricades are gameplay constraints. The current rickshaw, driver and world ground are explicitly procedural stand-ins, not recognizable production landmark art.
- Chunking and shared materials are implementation measures, not measured FPS evidence. No device frame-time claim is made.

## Not yet verified or complete

- New C# domain/real-map tests require the hosted .NET run after this checkpoint is pushed.
- Unity has not imported these sources locally. UI Toolkit, Input System, URP, WebGL interop and editor scene-generation APIs still require Unity compilation and Editor/PlayMode execution.
- No Unity-generated scene, Unity Web/APK artifact, device launch or performance trace exists yet. Run **Banglar Tesla → Setup → Configure Unity Project** in the pinned Unity editor to generate URP assets and the sourced scene through Unity serialization.
- Passenger/cargo jobs, full traffic/pedestrians, police/road rage, destruction, all ten Blacklist rivals/races, production landmarks, localization/menu/audio and the remaining presentation/parity systems are still outstanding.
- Existing TypeScript browser/Android success and v0.6.7 release evidence do not verify this Unity code.

Refer to `UNITY_PRODUCTION_MIGRATION_PLAN.md` for the acceptance gates and `GEOGRAPHIC_IMPORT_REPORT.md` for source provenance.
