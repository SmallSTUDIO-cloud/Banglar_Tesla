# Known issues & limitations — 0.6.7

Severity: **S1** blocks release · **S2** noticeable / needs work · **S3** cosmetic or by design.

Last revised against commit `8379f25` (tag `v0.6.7`). Claim-by-claim re-verification
against the source tree on 2026-11-07 is recorded at the end of this file.

## S1 — Blocking for a Play Store release

| # | Issue | Impact | Plan |
|---|---|---|---|
| 1 | **No release-signed AAB.** `npm run build:apk` produces a debug-signed APK. No Play Console artifact exists. | v0.6.7 can be sideloaded and is verified, but it cannot be published. It may also refuse to install over an app signed with a different key. | Configure a private release upload keystore, then build a signed AAB. See [ANDROID_BUILD.md](ANDROID_BUILD.md). |
| 2 | **No measured performance on physical hardware.** Every frame-time and draw-call figure in this repository was captured under headless Chromium / SwiftShader, which is not representative of a phone GPU. | We cannot state "30 FPS on low-end Android", and no release note currently does. | Profile on the actual target device before any performance claim. Quality presets, dynamic fallback and draw-call discipline are already in place. |

## S2 — Notable gaps

| # | Issue | Detail |
|---|---|---|
| 3 | One district only | Mohammadpur (Dhaka-1207) is modelled from OpenStreetMap data. Other districts are backlog. |
| 4 | Pedestrians never leave the footpath | They pause and step aside, but never cross roads or enter shops. Still true in `src/ai/pedestrians.ts`. |
| 5 | Two mission kinds only | `passenger` and `market`. Fragile parcel, multi-stop, lost-item and scenic jobs are designed but not coded. |
| 6 | Dialogue set is small | Six passenger archetypes with a handful of contextual lines each. No branching conversations. |
| 7 | No photo mode | A rival's cinematic intro can be replayed from the Blacklist screen, but there is no photo mode, postcard export or driven-replay system. |
| 8 | No dedicated achievements screen | Achievements exist as data, fire toasts and persist correctly, but there is no screen to browse them. |
| 9 | Audio mix is untested by ear | All audio is synthesised at runtime. Nothing has been listened to under controlled conditions; volumes are conservative and adjustable per bus. |
| 10 | Free-ride POI messages are toast-only | Standing near the tea stall, garage or ghat shows its name; there is no interaction menu there. |
| 11 | Chan Miya Housing is absent | Named alongside Tajmahal Road as a required Mohammadpur landmark. Tajmahal Road is modelled with real OSM way IDs; Chan Miya Housing has zero references in `src/` or `docs/`. This is a content gap, not a regression. |
| 12 | Traffic does not negotiate crossings | Vehicles follow a lane graph and do select outgoing lanes at each junction, but they do not arbitrate priority with each other. A determined player can build a queue; it clears slowly. |

## S3 — Cosmetic / by design

| # | Issue |
|---|---|
| 13 | Night lighting is deliberately stylised (warm lamp pools, soft player fill) rather than physically accurate. |
| 14 | Rain is a single streak layer with no splash particles; wet-road response is a material change, not a reflection pass. |
| 15 | Building interiors are shallow recesses, not enterable rooms. |
| 16 | The far map edges are closed with boundary walls and roadblocks; there is no open-world streaming. |
| 17 | Minor texture stretching on some irregular parapets and awnings at very close camera distance. |
| 18 | `ধীরে চলুন` boards are single-sided planes and are invisible from behind. |
| 19 | Portrait play works and is usable, but the game is designed landscape-first. |
| 20 | Music loops are short (8 bars) and intentionally simple. |
| 21 | Main web bundle is ~1.25 MB raw / 349 kB gzip. Acceptable, but un-analysed. |

## Reporting

If you hit a crash or a broken loop, capture the browser console plus
`window.__banglarTesla.debugSnapshot()` — it reports mode, mission state, position,
balance, traffic count, quality and weather in one object.

---

## Verification record (2026-11-07)

This file previously carried the title "0.1.0" and described an
"Old-Dhaka-inspired block" with a single road network. That no longer matched the
shipped game, so each claim was rechecked against the source tree.

**Corrected because the old text was wrong:**

| Old claim | Verified reality |
|---|---|
| "One district only — Old-Dhaka-inspired block" | The world is **Mohammadpur**, built from `src/world/mohammadpurData.ts`: 50 edges marked `source: 'osm'` with real OSM way IDs, plus 22 `source: 'approx_lane'` procedural connectors that are explicitly labelled and never presented as survey data. |
| "No gamepad support — touch + keyboard only" | **False.** `src/core/input.ts` handles gamepads, including the Turbo bumper. |
| "Traffic shares three closed loops and does not compute alternative routes" | **Partly false.** `src/ai/routes.ts` builds a connected left-hand-drive lane graph and picks outgoing lanes dynamically at every junction. Vehicles still do not arbitrate priority against each other (#12). |

**Re-confirmed as still true:** no releasable signing (#1), no device measurements
(#2), no pedestrian road-crossing (#4), two mission kinds (#5), small dialogue set
(#6), no photo mode (#7), no achievements screen (#8), unlistened audio (#9),
toast-only POIs (#10).

**Checks run at the same time:** `tsc --noEmit` clean; 236/236 unit tests across
40 files; 5/5 Android pipeline tests; `vite build` successful.
