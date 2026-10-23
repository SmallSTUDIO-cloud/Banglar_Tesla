# Test report — Banglar Tesla 0.1.0

Environment as measured in the Arena build sandbox on **2026-10-23** (Asia/Dhaka).

| Item | Value |
|---|---|
| OS | Debian GNU/Linux 12 (bookworm), x86_64, kernel 6.1 |
| Node | v22.22.3 |
| npm | 10.9.8 |
| Vite | 7.3.7 |
| TypeScript | 5.9.3 (strict) |
| Vitest | 3.2.7 |
| three.js | 0.186.1 |
| Browser used for E2E | Chromium (bundled `@sparticuz/chromium`) headless shell, SwiftShader WebGL 2.0 software rasteriser |
| Device / GPU | none — no physical Android hardware available |
| Godot / Android SDK / JDK | **not available** (see `docs/ANDROID_PACKAGING.md`) |

---

## 1. Commands run and results

| # | Command | Result |
|---|---|---|
| 1 | `npx tsc --noEmit` | **PASS** — 0 errors (strict, `noUnusedLocals`, `noUnusedParameters`) |
| 2 | `npm run build` (`tsc && vite build`) | **PASS** — `dist/` built; JS 777 kB (209 kB gzip), CSS 21 kB (5 kB gzip) |
| 3 | `npx vitest run` | **PASS — 61/61 tests** in 4 suites |
| 4 | `npm run test:e2e` (`tests/e2e/run-e2e.mjs`) | **PASS — 21/21 checks** in a real Chromium |
| 4b | `npm run test:ui` (`tests/e2e/ui-flow.mjs`) | **PASS — 17/17 checks** driving the game only through real DOM clicks |
| 5 | `node tests/e2e/shoot.mjs menu,duty,garage,night,rain,rear` (landscape 960×540) | Screenshots reviewed visually at each iteration |
| 6 | `PORTRAIT=1 node tests/e2e/shoot.mjs menu,duty,garage` (412×892) | Portrait layouts reviewed and fixed |

`artifacts/e2e-results.json` holds the machine-readable result of the last E2E run (the folder is
git-ignored; re-run to regenerate).

---

## 2. Unit test suites (61 tests)

### `tests/unit/economy.test.ts` (12)
Fare composition, on-time vs late, tip thresholds, star ratings, daily multiplier, damage
deduction, determinism, repair quotes, `canAfford` guards, level ladder, upgrade stat caps,
damaged-vehicle slowdown, wet grip and tyre recovery, catalogue well-formedness.

### `tests/unit/save.test.ts` (21)
Default progress, v1→v2 migration, hostile-data sanitisation (negative balance, absurd
condition, bogus vehicle ids, wrong types), round-trip through storage, **corrupt-save recovery
from `.bak`** with the corrupt payload preserved, missing-save handling, backup creation,
settings persistence/clamping/enum rejection/reset, and GameState economy guards (starter
balance, overspend blocked, insufficient-funds reason, single-charge purchases, cosmetic
ownership, vehicle ride-locking, ride payout + tape/achievement unlocks, repair rules, reset).

### `tests/unit/driving.test.ts` (19)
Progressive acceleration, speed cap, coast-to-stop, brake-to-stop then deliberate reverse,
left/right steering direction, tighter low-speed turning circle vs. stable high-speed radius,
collision push-out from a wall AABB, stuck detection while pinned, speed humps (no launching),
determinism of the whole step loop, route loops, **left-hand lane side**, arc-length wrap
robustness, mission validity/determinism/variety, daily seed stability by date, distance model.

### `tests/unit/i18n.test.ts` (9)
Completeness of both languages, Bangla-script presence, placeholder parity between bn/en,
interpolation, missing-key fallback, locale switching, invalid-locale rejection, `৳` (never `$`),
no replacement characters or escaped/`????` strings.

---

## 3. End-to-end browser run (21 checks)

`tests/e2e/run-e2e.mjs` builds a preview server, launches headless Chromium with SwiftShader,
and drives the real game object (`window.__banglarTesla`). Because software WebGL renders far
below real time, gameplay assertions advance the **simulation** (`debugStepSim`/`debugStepUntil`)
instead of wall-clock timers — otherwise a slow rasteriser would mask real logic failures.

| # | Check | Result |
|---|---|---|
| 1 | main menu visible after boot | PASS |
| 2 | no page errors during boot | PASS |
| 3 | passenger duty entered HUD | PASS |
| 4 | a passenger job offer appears (Bangla copy, fare, distance) | PASS |
| 5 | mission started (`toPickup`) | PASS |
| 6 | pickup zone reached and passenger boarded (`toDropoff`) | PASS |
| 7 | rickshaw moves under pedal input (3.13 m travelled) | PASS |
| 8 | ride completed (rides counter +1) | PASS |
| 9 | fare paid in taka (balance 500 → 589) | PASS |
| 10 | garage screen opens | PASS |
| 11 | cosmetic purchase succeeds | PASS |
| 12 | settings screen opens with Bangla labels | PASS |
| 13 | quality preset changes real settings (low → shadows off) | PASS |
| 14 | language switches to English | PASS |
| 15 | progress survives reload (balance + rides) | PASS |
| 16 | purchase survives reload (owned cosmetics ≥ 2) | PASS |
| 17 | settings survive reload (quality = low) | PASS |
| 18 | free ride mode runs | PASS |
| 19 | pause opens and freezes simulation | PASS |
| 20 | no page errors for the whole run | PASS |
| 21 | no fatal console errors | PASS |

Last run: **21/21 passed**. Notable observed values from that run:
`{"rides":1,"balance":589,"missionState":"complete","traffic":10}` and
`{"audio":true,"tutorialDone":false}` (the Web Audio graph initialised from the tap/click gesture).

---

---

## 3b. UI click-through run (17 checks, no debug hooks)

`tests/e2e/ui-flow.mjs` clicks the real buttons a player would press — nothing is called on the
game object except reading `debugSnapshot()` to verify the effect.

| # | Check | Result |
|---|---|---|
| 1 | Play button is clickable | PASS |
| 2 | first launch shows the tutorial | PASS |
| 3 | tutorial completes into gameplay (`mode=duty`, HUD) | PASS |
| 4 | job offer card is on screen | PASS |
| 5 | accept button clickable | PASS |
| 6 | mission starts from the real accept button | PASS |
| 7 | HUD pause button opens pause | PASS |
| 8 | resume button returns to driving | PASS |
| 9 | quit-to-menu confirmation returns to the menu | PASS |
| 10 | Store button clickable | PASS |
| 11 | store screen opens from the menu | PASS |
| 12 | Garage button clickable | PASS |
| 13 | repair via the garage button restores condition (86 → 100) | PASS |
| 14 | Settings button clickable | PASS |
| 15 | language switches through the real control (bn → en, labels re-render) | PASS |
| 16 | English menu is reachable and renders | PASS |
| 17 | no page errors during the click-through | PASS |

Last run: **17/17 passed**.

One real bug was found by this test and fixed: opening the garage from the main menu and
closing it used to drop the player into the (never-started) gameplay HUD. Navigation now
remembers where each sheet was opened from.

## 4. Visual review log (what I looked at, and what changed because of it)

| Screenshot | Issue found | Fix applied |
|---|---|---|
| `artifacts/01-menu.png` | Menu buttons covered the rickshaw; emoji glyphs (🛺/📅/🎥/🔔) rendered as tofu boxes in the test font stack | Rebuilt menu as a left-docked glass panel with SVG mode icons; replaced all emoji with inline SVG icons; added font-family inheritance for buttons |
| menu hero framing | Rickshaw sat under the panel | Menu camera now offsets the subject into the free right third (portrait: raises and re-frames above the panel) |
| HUD label `সান` (mood) | Mood row broke into vertical characters because the progress bar had no fixed width | Made the mood pill a bounded flex row with a fixed-width bar; hidden entirely when no passenger is aboard |
| Garage | Preview nearly black; rickshaw hidden behind the sheet | Rebuilt showroom lighting (key/rim/fill/lamps, brighter hemisphere), pushed the subject into the left third, docked sheets to the right in landscape |
| Duty (daylight) | Asphalt too dark, patch blotches read as holes, gap of raw ground between kerb and shops | Raised asphalt base and reduced patch/crack opacity, added apron paving between footpath and building line, brighter sun/ambient, gentler fog |
| Rear view | Rear art panel hidden behind its frame; mudguards were flat discs covering the wheels; driver's arms floated horizontally | Moved the art plane behind the frame, replaced guards with slim arcs, rebuilt arms/hands reaching the bars |
| Night | Whole street flooded grey by the room light probe; no lamp pools near the player | Dimmed `scene.environmentIntensity` at night, added warm shop/window glow layer, more + stronger lamps with bulbs, night player fill light |
| Rain | Rain invisible | Replaced point particles with short bright streaks (one draw call) and wet-road darkening/sheen |
| Portrait (412×892) | Pedal button clipped off-screen; mood text rotated | Portrait-specific control sizing, tighter padding, mood pill fix |

---

## 5. What was **not** tested here (and why)

* **Real Android device** performance, thermals, safe-area notches, back-button and
  app-pause/resume behaviour — no device or emulator is available in this sandbox.
* **Native APK/AAB export** — no Android SDK, JDK, Gradle, or Godot editor/templates.
* **Audio listening tests** — the Web Audio graph initialises and every sound path executes
  without exceptions, but nobody can *hear* it in a headless sandbox; the mix was set by
  measurement-free judgement and is documented as such.
* **Multi-touch on hardware** — the code uses pointer events with per-button capture and the
  E2E run exercises single-pointer synthetic input only.

These are called out again in `docs/KNOWN_ISSUES.md` rather than hidden.
