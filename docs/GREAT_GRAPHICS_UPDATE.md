# Great Graphics Update — implementation checkpoint (29 October 2026)

**Status: partial, not the requested complete graphics overhaul.** See `GREAT_GRAPHICS_UPDATE_PLAN.md` for the complete pre-implementation mapping and `GREAT_GRAPHICS_UPDATE_TEST_REPORT.md` for reproducible tests and limitations. Branch `arena/1cbc19eb-banglar-tesla`; recovery checkout was committed without discarding files and merged normally with the prior pushed branch before new work.

## Implemented and verified

1. **Traffic:** isolated forward-only player detection, retaining lane-width checks and excluding rear/side approaches; removed stuck-timer override when the player remains ahead. Capped angular turning rate by vehicle class, limited turn speed, and decayed small positional discontinuities at graph junctions. These are improvements, not proof that all intersections and wide vehicles are smooth; test coverage is mostly mathematical, not a complete driven route audit.
2. **Graphics UI:** dedicated phone-scrollable localized Graphics screen reached from existing Settings; hardware Back and close return to Settings. Performance, Balanced, High and Custom persist. Presets change existing quality/population/shadow configuration, 3D render scale, FPS target, rain mode/density, wetness and lightning settings without overwriting weather selection. Individual controls mark Custom; reset only changes graphics fields. Existing saves infer old quality, invalid values are sanitized. Existing audio, controls and all six weather selections stay in Settings. Did not expose unsupported bloom, VSync, contact shadows, motion blur, DoF, reflections or decorative world-detail toggles; this is an explicit **scope gap**, not a hidden implementation.
3. **Rain:** bounded pooled line-segment rain (700 allocated slots, draw range bounded by quality and selected density); Dynamic uses more visible drops and wind slant plus existing ten screen-water droplets, while Normal omits those screen droplets. Wet-road toggle drives wetness toward zero; lightning toggle suppresses strike illumination. Weather still decides whether rain occurs. **Not implemented:** new wheel splashes, puddles/reflections or fresh wet-surface art. CPU, visual quality and storm coherence on real Android remain unverified.
4. **Frame pacing and quiet hours:** skipped callbacks genuinely skip both simulation and draw while preserving elapsed time for fixed-step simulation; clamps stalls. No browser VSync toggle is claimed. Quiet population factor decreases continuously 00:00→03:30, stabilizes, restores through 07:00; 22:00→00:00 tapers gradually, one ambient vehicle joins/leaves per two seconds and near-player tail vehicles are never removed. Newly spawned CNGs are less frequent at night. Existing pedestrian density, city lighting and phase-based sky remain as before.
5. **Preservation:** no city geometry, map graph, road widths, DRMC boundaries, rig, missions, asset set or gameplay structures were deleted or moved. World visuals remain broadly unchanged, so this work does **not** meet the brief's main city/road/lighting/physics/mirror ambitions.

## Engineering references and skill decisions

| Source | Principle adopted / decision |
|---|---|
| [Vercel Labs find-skills SKILL](https://github.com/vercel-labs/skills/blob/main/skills/find-skills/SKILL.md) | Read discovery/provenance guidance. Repo has no installed skill instructions; no third-party installer/scripts run. Rejected unverified packages and code. |
| [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html), [merging geometry](https://threejs.org/manual/pages/optimize-lots-of-objects.html) | Reuse existing instanced traffic; avoid per-agent mesh allocation. Did not merge city geometry because spatial culling/visual comparison would need proof. |
| [Three.js renderer.info](https://threejs.org/docs/pages/WebGLRenderer.html), [disposal](https://threejs.org/manual/pages/how-to-dispose-of-objects.html) | Count renderer calls/geometry/textures and guard resource lifecycle. Rain is pooled, not rebuilt every frame; no new render targets or unowned disposal. |
| [Unreal visibility principles](https://dev.epicgames.com/documentation/unreal-engine/visibility-and-occlusion-culling-in-unreal-engine), [Unity profiling/LOD](https://docs.unity.com/en-us/engine/6000.0/manual/analysis/graphics-performance-profiling) | Adapt principle of bounded visibility and profile-before-optimization; do not claim these engines' occlusion systems are in Three.js. |

### Transferable open-world/AAA principles — feasibility decisions

| Reference | Specific transferable technique | Banglar Tesla benefit | Development risk/cost | Mobile cost | Decision |
|---|---|---|---|---|---|
| Three.js instancing manual (shared with large game worlds) | repeated static meshes with shared material, spatially chunked for culling | richer frontage without linear draw calls | medium: property and collision placement verification | low–medium | defer until matched visual QA |
| Unreal visibility documentation | frustum/bounds checks before draw | dense Dhaka street scene with fewer invisible objects | medium: bad bounds can hide needed landmarks | low, can save GPU | keep principle; existing culling retained |
| Unity graphics profiling docs | measure GPU/CPU costs and LOD against captures | preserve near-road silhouette while simplifying distant geometry | medium–high authoring/visual risk | potentially saving | defer until hardware baseline |
| Existing driving/racing design and traffic system | readable anticipation and predictable front-facing braking | controllable street driving and race fairness | medium: junction and mission regressions | negligible | keep partial corridor/turn changes, audit more |
| Modern mobile open-world approach | continuous environmental response rather than sudden population collapse | quieter night, stable road cues | low–medium AI interaction | small CPU saving | keep graduated ambient traffic; defer lighting/sky transition |

No protected game maps, character likenesses, music or assets were imported. No engine migration was attempted.

## Work not completed

- Lighting exposure, sky continuity, street/store illumination and rain-at-night art; city gap closure/facade modules/accessories; road markings, authored potholes and wheel/vehicle-specific suspension. No claim of improved physical handling.
- Driver/limb rigs and NPC fleet appearance across camera states; true driver-camera-only rear-view render targets. Existing `mirror.round` cosmetic is **not** a working rear-view mirror.
- Full NPC lane curvature/turn-radius and intersection-right-of-way validation; front-only yielding does not solve blocked intersections, moving queues, passing legality or all AI path issues.
- Normal/Dynamic rain wheel splashes, moving/fading droplets calibration, puddles and headlight reflections; gradual evening sky transitions and pedestrian quiet-hours reduction.
- Map and mission route consistency audit across all gameplay states, new LOD/chunks/texture atlas, adaptive resolution, dynamic-light/shadow tiers, advanced effects, capability detection, restoration after WebGL context loss.
- Repeated **matched** visual captures and timings across all four presets/weather/time/camera/race combinations, physical mobile GPU or device QA, audio audition, and complete gameplay-driven boss race success. Do not interpret the browser fixture race result as a driven victory.

## APK and source protection

`npm run build:apk` was attempted on this checkout after the changes; the web build passed but `scripts/build-apk.py` stopped at `Missing aapt2 at /tmp/android-tools/node_modules/aaptjs3/bin/x64/linux/aapt2`. No installed Java/JDK, Android SDK/platform, `android.jar`, Gradle wrapper, or `adb` were found. The native project is an offline Android WebView wrapper, not a configured Capacitor integration. Official Android SDK artifacts are not reachable via the permitted network hosts; do not replace them with random npm binaries. No APK was produced or device installed. On a trusted machine/CI with the official SDK 34 build-tools/platform and JDK, use the native Android Gradle project with an appropriate maintained Gradle wrapper or provision the **documented** exact local script prerequisites from trusted sources, run debug packaging and verify metadata/signature/assets. Release signing requires a legitimate private keystore; it has not been provisioned.
