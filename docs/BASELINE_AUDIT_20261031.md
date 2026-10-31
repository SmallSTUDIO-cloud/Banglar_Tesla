# Current-progress baseline and APK audit — 2026-10-31

**Scope:** freeze existing work; no feature development. Branch `arena/1cbc19eb-banglar-tesla`. This document records checks made **before the baseline commit**; GitHub Actions and release outcomes must be read from the actual run/release, not inferred from this plan.

## File audit

The starting working tree had **39 modified tracked files and 60 untracked paths**, no staged files. Tracked changes were inspected by status/diff/stat and grouped as follows:

- `src/ai`, `src/events`, `src/gameplay`, `src/game.ts`, `src/missions`: intentional Dhaka market/checkpoint, passenger/detour, owned barrier and retained traffic/pedestrian/contact work.
- `src/world`, `src/vehicle`, `src/styles.css`, `src/ui`, `src/audio`, `src/core`, `src/economy`, `src/blacklist`: intentional prior weather, lighting, LOD/culling, potholes, physics, mirrors, UI, garage/progression, race and localization changes. These are not disposable output.
- `android/app/build.gradle`, Android manifest, `scripts/build-apk.py`, `package.json`, packaging docs: intentional official-Gradle migration and reproducible preflight, retaining app ID `com.shostalab.banglartesla`, minSdk 24, target/compileSdk 34, versionCode 7 and versionName 0.6.0.
- Modified `tests/e2e` and `tests/unit`: intentional regression fixtures; not captures. Existing source files were not reverted or rewritten for cleanliness.
- Untracked checked-in Gradle wrapper (four files, official wrapper JAR checksum `cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8`), three `src/` modules, 14 `docs/` reports/plans/requirements, and 39 additional `tests/` scripts/cases were inspected for names/types/sizes. They are intentional work to retain, including the large visual requirements document. This pass additionally adds `tests/build/test_apk_pipeline.py`, this audit, and fixes the existing Android Actions workflow to invoke the same checked-in Gradle pipeline instead of hand-assembling a separate APK.

No untracked PNG, APK, keystore, SDK, node_modules, dist bundle or local build output was selected for Git. `artifacts/`, `dist/`, Android build output, `assets/public/`, Gradle cache and local.properties stay ignored. A source/docs/tests/Android secret-pattern scan found no private key or GitHub token. This does **not** mean the earlier ignored artifact directories were untouched: the standalone stress and director fixtures write their existing hard-coded ignored paths. Do not stage those outputs.

The pre-existing GitHub `v0.6.0` release is **not** this baseline. The workflow is now configured for a distinct `v0.6.0-baseline-20261031` release **only after** a successful build, either manually dispatched or explicitly opted in by a push commit marked `[release-baseline-20261031]` (the local integration token cannot dispatch Actions: HTTP 403); it must not overwrite the old release or silently replace its APK. It publishes a debug-signed test APK only. No existing tag, version code, package identity or release signing configuration is changed.

## Test evidence (local sandbox)

Fresh `npm ci` succeeded (104 packages). The first attempt before dependency installation failed at setup (`tsc`/`vitest` unavailable and browser scripts lacked their modules); it is **not** counted as a test failure or a pass. After `npm ci`, `npm run build` passed. Logs: ignored `artifacts/baseline-20261031/`.

| Test | Fresh result |
|---|---|
| `npm test` | **38 files / 238 tests passed** |
| `npm run test:e2e` | **21/21 passed** |
| `npm run test:mobile` | **13/13 passed**, browser mobile UI, not device |
| `npm run test:ui` | **33/33 passed** |
| `npm run test:spec` | **12/12 passed** |
| `npm run test:upgrade` | **17/17 passed** |
| `npm run test:v05` | **13/13 passed** |
| `npm run test:vnext` | **9/9 passed** |
| `npm run test:vnext-repair` | **9 PASS checks** |
| `npm run test:android-pipeline` | Initially failed **before discovery** (`tests/build` absent, **0 tests executed**). After adding four offline packaging/preflight guards: **4/4 passed**. These guards are **not** APK execution tests. |
| Standalone `dhaka-first-events`, `drive-drmc-live`, `drive-race-live`, `traffic-advanced`, `traffic-junction`, `aaa-contact`, `contact-matrix`, `stress-v2-benchmark` | All exited **0** in fresh runs. Race finished all gates with no recovery but **lost** to rival (80.4 s vs 67.6 s); not a win. Stress **9/9**, simulated/software, not device FPS. |

Other visual-capture/benchmark utilities are **not** counted as test passes; they create fixtures and/or screenshots. Previous 37 matched scenes are documented in `DHAKA_FIRST_CONTINUATION_REPORT.md`; they were not recaptured solely for this packaging audit. No skipped/timed-out run is counted as passing.

## Toolchain and build boundary

The local sandbox has a verified complete Gradle 8.7 wrapper (checksum-pinned distribution), AGP 8.5.2 project and built web `dist/`. **`ANDROID_HOME` and `ANDROID_SDK_ROOT` are unset; there is no local Android SDK Platform 34 or Build Tools 34.0.0, and `java`, `javac`, `adb`, `aapt2` are absent.** `python3 scripts/build-apk.py --check` fails specifically: `Android SDK not configured: set ANDROID_HOME (or ANDROID_SDK_ROOT), or android/local.properties sdk.dir`. Its checks stop at the first missing prerequisite, so an installed SDK would also require official Platform 34, Build Tools 34.0.0, JDK 17 and Gradle distribution retrieval. No local Gradle assemble, APK, install or device test occurred. No unofficial Android binary is substituted.

For a reproducible local build, install official JDK 17 and Android SDK (Platform 34, Build Tools 34.0.0; Platform Tools for a device), accept licenses, point `JAVA_HOME` and `ANDROID_HOME` at them, then `npm ci && npm run build:apk`. The Python launcher runs the verified wrapper and checks zip alignment, apksigner certificate/signature, `aapt` badging and exact bundled web assets. CI installs those official tools and invokes that same launcher. Read its **actual** Actions log and APK asset before claiming a successful build. A physical-device installation, performance profile and human audio review remain separate.
