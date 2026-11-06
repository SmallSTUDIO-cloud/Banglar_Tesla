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
- Hosted `Unity Domain Tests` run `42234144355` passed on commit `16ef164`, compiling the engine-free
  domain plus tests and executing the real-map integration suite against the regenerated fixture.
  This covers domain logic only; it does not load Unity, URP, UI Toolkit or the Input System.
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

## Alpha 0.1 progress (verification checkpoint)

| Milestone requirement | State | Verification |
| --- | --- | --- |
| Functional rickshaw + driving physics | Domain exists | Domain tests exist, **not executed here** |
| Sourced Mohammadpur road network | Rendered from OSM graph | Offline importer tests pass 6/6; nothing rendered in Unity yet |
| Basic traffic | **Added this session** (domain + pooled view) | 8 new domain tests, executed on hosted CI |
| Mobile controls | HUD + input exist | Never loaded by Unity |
| Working camera | Seven modes exist | Never loaded by Unity |

### Traffic (new)

- `Runtime/Domain/Traffic.cs`: deterministic, engine-free lane-following traffic on the sourced
  graph — left-hand lane offset, car-following with comfort/stopping gaps, junction continuation
  weighted by road class and name, one-way enforcement, and an entry gate so vehicles queue
  instead of teleporting. Reused sort buffer and allocation-free junction selection: the only array is the
  reusable sort index, resized only when the agent count changes.
- `Runtime/Presentation/TrafficView.cs`: pooled renderers sharing one box mesh and three materials,
  colour variants per agent, distance culling that disables renderers instead of destroying them.
- `Runtime/GameBootstrap.cs`: density derived from the graphics profile (36 / 72 / 120 agents).
  The legacy traffic-density *setting* is not migrated yet — it is derived, not user-editable.
- `Tests/EditMode/Domain/TrafficTests.cs` (8 tests): spawn placement, determinism under a fixed seed,
  non-overlap, speed bounds, one-way enforcement, acceleration limits, dead-end recycling, 2000-step
  stability.
- One-way dead ends have no legal continuation, so agents that reach one are recycled to a free
  spawn point instead of blocking the road permanently. Two-way dead ends turn around in place.

Traffic is simulated on the road graph only: there is no signal control, no pedestrian or
player interaction, and no collision response against the rickshaw yet.

### HUD panel fix

`DrivingHudController` previously created `PanelSettings` at runtime with no `themeStyleSheet`;
a runtime instance also has no blit shaders, so the HUD would be unstyled or invisible in a player
build. The editor setup menu now authors `Assets/BanglarTesla/Settings/BanglarTesla-HudPanel.asset`
with the UI Toolkit default runtime theme, assigns it through `GameBootstrap.HudPanelSettings`, and
readiness validation fails when the asset or theme is missing. The runtime fallback remains but
warns, and destroys the panel it created.

## Static analysis (new, replaces nothing)

`scripts/audit-unity-csharp.py` parses the Unity sources with tree-sitter and reports four defect
classes that a compiler would otherwise catch first. Each check has been validated by deliberately
reintroducing a bug and confirming it is reported:

1. syntax errors;
2. project types used without a visible `using`/namespace (caught a missing
   `using BanglarTesla.Domain.Maps;` in the new traffic file);
3. void methods used where a value is required (caught `Sample(...)` misused as an expression);
4. member accesses absent from the receiver's project type.

It is explicitly **not** a compiler: it does not type-check, does not validate Unity API usage,
and cannot prove the code builds. Current output: 44 files, 0 findings in all four classes.

## Verification status for this session

- Cannot compile or run anything locally: no Unity editor, no .NET SDK, no C# compiler, and the
  hosting network blocks the .NET SDK download. Verification therefore runs on hosted CI via an
  explicitly authorized push to this branch; results are recorded in the next section.
- Executed this session: offline geography suite (6/6), static audit (0 findings), `git diff --check`.
- **Not** executed: any C# compilation, EditMode/PlayMode test, Unity scene generation, URP render,
  WebGL build, Android build, device launch, or frame-time measurement.
