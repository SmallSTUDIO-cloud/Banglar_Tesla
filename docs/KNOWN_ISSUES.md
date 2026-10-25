# Known issues & limitations (0.1.0)

Severity: **S1** blocks release · **S2** noticeable / needs work · **S3** cosmetic or by design.

## S1 — Blocking for a Play Store release

| # | Issue | Impact | Plan |
|---|---|---|---|
| 1 | **Debug-signed test APK only (not a Play Store release AAB).** `npm run build:apk` packages `dist/` into `banglar-tesla-v0.1.0-android-test-debug.apk` (`com.shostalab.banglartesla`) signed with a standard Android debug key. | Suitable for direct sideloading on Android phones (`Install unknown apps`), not Play Console upload. | Build a release-signed `.aab` from `android/` (`./gradlew bundleRelease`) with a private upload keystore before Play Store submission. |
| 2 | **No measured performance on real phones.** Frame time was only observed under a software rasteriser, which is not representative. | Cannot claim "30 FPS on low-end devices". | Quality presets, dynamic fallback and strict draw-call discipline are in place; must be profiled on real hardware before release. |

## S2 — Notable gaps in the slice

| # | Issue | Detail |
|---|---|---|
| 3 | One district only | Old-Dhaka-inspired block. Riverfront/commercial/residential districts are backlog. |
| 4 | Traffic is route-following | Vehicles share three closed loops with car-following and signals. They do not compute alternative routes or negotiate crossings with each other, so a determined player can create a queue (it clears, but slowly). |
| 5 | Pedestrians never leave the footpath | They pause and step aside, but do not cross roads or enter shops. |
| 6 | Only one passenger job archetype is implemented | Standard passenger delivery + a cosmetic "optional request" tag. Fragile parcel, multi-stop, lost-item and scenic missions are designed but not coded. |
| 7 | Dialogue set is small | Six passenger archetypes × a handful of contextual lines. No branching conversations. |
| 8 | No photo mode / replays / postcard export | Planned in Phase 2. |
| 9 | Achievements exist in data and fire toasts, but there is no dedicated achievements screen | Unlocked flags persist correctly. |
| 10 | Audio mix is untested by ear | All audio is synthesised at runtime; nothing was listened to in a headless sandbox. Volumes are conservative and individually adjustable. |
| 11 | No gamepad support | Touch + keyboard only. |
| 12 | Free-ride POI messages are toast-only | Standing near the tea stall, garage, ghat etc. shows its name; there is no interaction menu there yet. |

## S3 — Cosmetic / by design

| # | Issue |
|---|---|
| 13 | Night lighting is deliberately stylised (warm lamp pools + soft player fill) rather than physically accurate. |
| 14 | Rain is a single streak layer with no splash particles; wet-road response is a material change, not a reflection pass. |
| 15 | Building interiors are shallow recesses, not entering-able rooms. |
| 16 | The far edges of the map are closed with boundary walls; there is no open-world streaming. |
| 17 | Minor texture stretching can be seen on some irregular parapets and awnings at very close camera distance. |
| 18 | The `ধীরে চলুন` boards are single-sided planes; from behind they are invisible. |
| 19 | Portrait play works and is fully usable, but the game is designed landscape-first (as the manifest requests). |
| 20 | Music loops are short (8 bars) and intentionally simple; a longer arrangement needs a music budget. |

## Reporting

If you hit a crash or a broken loop, capture the browser console plus
`window.__banglarTesla.debugSnapshot()` — it reports mode, mission state, position, balance,
traffic count, quality and weather in one object.
