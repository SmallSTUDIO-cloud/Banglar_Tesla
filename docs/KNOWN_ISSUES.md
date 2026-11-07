# Known issues & limitations — 0.6.7

Severity: **S1** blocks release · **S2** noticeable / needs work · **S3** cosmetic or by design.

Every entry carries an evidence status, so a confirmed defect is never confused
with a guess:

- **CONFIRMED** — read directly out of the source tree or reproduced by a test in
  this repository.
- **UNVERIFIED** — a real limitation, but the evidence required to characterise it
  (physical device, human ear, store review) has not been gathered.
- **PLANNED** — a designed feature that is genuinely not implemented yet.
- **BY DESIGN** — deliberate scope or stylistic choice, not a defect.

Last revised against commit `8379f25` (tag `v0.6.7`). Claim-by-claim re-verification
against the source tree on 2026-11-07 is recorded at the end of this file.

## Current production architecture

- **Rendering:** Three.js (pinned by `package.json`), WebGL.
- **Language / tooling:** TypeScript with strict checking, Vite for build and dev server.
- **Web delivery:** static bundle in `dist/`, deployed to GitHub Pages from `main`.
- **Android:** Capacitor wrapper (`capacitor.config.json`), `com.shostalab.banglartesla`,
  minSdk 24, targetSdk 34, versionCode 11, packaged by `scripts/build-apk.py`.
- **Runtime dependencies:** `three` only. All audio, textures, geometry and models are
  generated in code at runtime; there are no shipped image, font or audio asset
  pipelines beyond user-supplied posters.
- **Persistence:** `localStorage` on web, plugin storage on Android, with migration,
  `.bak` backup and corrupt-save recovery.
- **World data:** `src/world/mohammadpurData.ts` (50 road edges from OpenStreetMap way
  IDs, 22 explicitly labelled procedural connectors). Raw OSM source for research and
  re-derivation lives in `data/mohammadpur/`.
- **Scale:** ~33,900 lines across 66 TypeScript files in `src/`.

**Three.js is the sole production engine.** A Unity/C# migration was explored in
2026 and permanently discontinued; all of its project files, code, workflows and
documentation have been removed from this repository. No Unity code exists here
and none is planned. `data/mohammadpur/` holds the OpenStreetMap source data that
survived the removal because it is shared reference material.

## S1 — Blocking for a Play Store release

| # | Status | Issue | Impact | Plan |
|---|---|---|---|---|
| 1 | **CONFIRMED** | **No release-signed AAB.** `npm run build:apk` produces a debug-signed APK. No Play Console artifact exists. | v0.6.7 can be sideloaded and is verified, but it cannot be published. It may also refuse to install over an app signed with a different key. | Configure a private release upload keystore, then build a signed AAB. See [ANDROID_BUILD.md](ANDROID_BUILD.md). |
| 2 | **UNVERIFIED** | **No measured performance on physical hardware.** Every frame-time and draw-call figure in this repository was captured under headless Chromium / SwiftShader, which is not representative of a phone GPU. | We cannot state "30 FPS on low-end Android", and no release note currently does. | Profile on the actual target device before any performance claim. Quality presets, dynamic fallback and draw-call discipline are already in place. |

## S2 — Notable gaps

| # | Status | Issue | Detail |
|---|---|---|---|
| 3 | **CONFIRMED** | One district only | Mohammadpur (Dhaka-1207) is modelled from OpenStreetMap data. Other districts are backlog. |
| 4 | **CONFIRMED** | Pedestrians never leave the footpath | They pause and step aside, but never cross roads or enter shops. Still true in `src/ai/pedestrians.ts`. |
| 5 | **CONFIRMED** | Two mission kinds only | `passenger` and `market`. Fragile parcel, multi-stop, lost-item and scenic jobs are designed but not coded. |
| 6 | **CONFIRMED** | Dialogue set is small | Six passenger archetypes with a handful of contextual lines each. No branching conversations. |
| 7 | **PLANNED** | No photo mode | A rival's cinematic intro can be replayed from the Blacklist screen, but there is no photo mode, postcard export or driven-replay system. |
| 8 | **CONFIRMED** | No dedicated achievements screen | Achievements exist as data, fire toasts and persist correctly, but there is no screen to browse them. |
| 9 | **UNVERIFIED** | Audio mix is untested by ear | All audio is synthesised at runtime. Nothing has been listened to under controlled conditions; volumes are conservative and adjustable per bus. |
| 10 | **CONFIRMED** | Free-ride POI messages are toast-only | Standing near the tea stall, garage or ghat shows its name; there is no interaction menu there. |
| 11 | **CONFIRMED** | Chan Miya Housing has a road and a race waypoint but no landmark | It is **not** missing from the codebase, contrary to an earlier note in this file. Present today: OSM node `13990591896` (`চানমিয়া হাউজিং` / `Chanmia Housing`, `place=neighbourhood`, `23.7598997, 90.3580661`); road segment `chanmia_s` "Chanmia Housing Rd" in `src/world/mohammadpurData.ts:145`, flagged `source: 'approx_lane'`; and race waypoint `sc_chanmia_03` "Chanmia Housing Bypass" in `src/blacklist/raceRoutes.ts:381`. What is genuinely absent is a `PLACES` landmark entry and any dedicated building, so the neighbourhood cannot be a pickup/drop destination or display a named POI. See `docs/CHAN_MIYA_HOUSING_PROPOSAL.md`. |
| 12 | **CONFIRMED** | Traffic does not negotiate crossings | Vehicles follow a lane graph and do select outgoing lanes at each junction, but they do not arbitrate priority with each other. A determined player can build a queue; it clears slowly. |

## S3 — Cosmetic / by design

| # | Status | Issue |
|---|---|---|
| 13 | **BY DESIGN** | Night lighting is deliberately stylised (warm lamp pools, soft player fill) rather than physically accurate. |
| 14 | **BY DESIGN** | Rain is a single streak layer with no splash particles; wet-road response is a material change, not a reflection pass. |
| 15 | **BY DESIGN** | Building interiors are shallow recesses, not enterable rooms. |
| 16 | **BY DESIGN** | The far map edges are closed with boundary walls and roadblocks; there is no open-world streaming. |
| 17 | **BY DESIGN** | Minor texture stretching on some irregular parapets and awnings at very close camera distance. |
| 18 | **BY DESIGN** | `ধীরে চলুন` boards are single-sided planes and are invisible from behind. |
| 19 | **BY DESIGN** | Portrait play works and is usable, but the game is designed landscape-first. |
| 20 | **BY DESIGN** | Music loops are short (8 bars) and intentionally simple. |
| 21 | **BY DESIGN** | Main web bundle is ~1.25 MB raw / 349 kB gzip. Acceptable, but un-analysed. |

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

**Also corrected on 2026-11-07 (second pass):**

| Old claim | Verified reality |
|---|---|
| "No `BufferGeometryUtils` / `mergeGeometries` usage (0 hits)" (recorded in the recovery plan, not here) | **False.** `mergeGeometries` is imported and used in `src/world/geo.ts`; `BufferGeometryUtils` appears twice overall. The count came from `grep -E` with `\|`, which matches a literal pipe instead of alternation, so the pattern could never match. Pooling likewise appears 32 times. |
| "Chan Miya Housing has zero references in `src/` or `docs/`" | **False.** A road segment `chanmia_s` and a race waypoint `sc_chanmia_03` both exist. The earlier search used `chan ?miya`, which cannot match the single-word spelling "chanmia" actually used in the code. |

Both errors had the same root cause: a search pattern that could never match was
mistaken for absence of the thing being searched for. Counts in this file are now
produced with fixed-string or correctly-escaped patterns.

**Checks run at the same time:** `tsc --noEmit` clean; 236/236 unit tests across
40 files; 5/5 Android pipeline tests; `vite build` successful.
