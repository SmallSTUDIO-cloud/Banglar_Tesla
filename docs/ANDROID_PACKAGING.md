# Shipping to Android

`android/` contains the native Android WebView wrapper (`com.shostalab.banglartesla`, `Banglar Tesla`, `sensorLandscape`, immersive fullscreen, offline bundled `assets/public/` via `AssetWebViewClient`, and hardware Back-button pause handling).

* **Current authoritative instructions:** [ANDROID_BUILD.md](ANDROID_BUILD.md). `npm run build:apk` invokes the existing Android Gradle project with an official JDK/SDK/Gradle installation; expected debug output is `android/app/build/outputs/apk/debug/app-debug.apk`. The checked-in, checksum-verified Gradle 8.7 wrapper is under `android/`. A debug APK is not a release-signed Play Store artifact.
* **Historical alternatives below** are background from the initial slice, **not** the current APK build path. Do not run Capacitor sync over the checked-in native project.

Below are the additional background notes from the initial vertical slice.

---

## Why not Godot (the brief's recommendation)

The master brief asks for Godot 4.x + GDScript + Mobile renderer and an APK. In this environment:

```
$ which godot jdk java javac gradle sdkmanager adb   → (nothing)
$ curl -L https://github.com/godotengine/godot/releases/download/.../Godot_v4.7.2-stable_linux.x86_64.zip
  curl: (35) OpenSSL SSL_connect ... release-assets.githubusercontent.com:443
```

* The editor binary and export templates are hosted on `release-assets.githubusercontent.com`,
  which is not on this sandbox's allowlist (only `github.com`, `codeload.github.com`,
  `api.github.com`, npm and PyPI are).
* Even with the editor, exporting requires an Android SDK (`build-tools`, `platform-tools`,
  `cmdline-tools`), a JDK, and Godot export templates — none are installed and none are
  installable from the allowed hosts.

Publishing an unrun Godot project would have violated the brief's own rule 3 (“never claim a
build or test succeeded unless you actually ran it”). The slice was therefore implemented on the
supported web/three.js stack so that every claim in `docs/TEST_REPORT.md` is backed by a real
run.

---

## Route A — wrap the web build (fastest, works today)

The game is a static bundle with an offline service worker. It already runs fullscreen on
Android Chrome.

### A1. Installable PWA (zero packaging)

1. `npm run build`
2. Serve `dist/` over **HTTPS** (PWA install + service worker require a secure context).
3. On the phone: Chrome → menu → *Add to Home screen*.

Result: fullscreen landscape app, own icon, offline after first load. No store listing, no
install friction, no permissions requested.

### A2. Trusted Web Activity (Play Store) with Bubblewrap

```bash
npm i -g @bubblewrap/cli
npm run build                     # produces dist/
# host dist/ at https://your.domain/banglar-tesla/  (manifest start_url must match)
bubblewrap init --manifest https://your.domain/banglar-tesla/manifest.webmanifest
bubblewrap build                  # → app-release-signed.apk / .aab
```

Bubblewrap needs the JDK + Android SDK on the machine doing the build (installed via
`bubblewrap doctor`). Requirements: the site must be HTTPS, the manifest must include icons and
a `start_url` inside the hosted scope, and Digital Asset Links must be published at
`/.well-known/assetlinks.json`.

### A3. Capacitor (if you need native plugins later)

```bash
npm i @capacitor/core @capacitor/cli @capacitor/android
npx cap init "Banglar Tesla" bd.banglartesla.game --web-dir=dist
npm run build
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug     # or bundleRelease for an .aab
```

Set `android:screenOrientation="sensorLandscape"` and a fullscreen theme in
`android/app/src/main/AndroidManifest.xml`, and copy `public/sw.js` expectations accordingly
(Capacitor serves from `https://localhost`, so the service worker is optional).

**Play Store specifics:** unique `applicationId` (suggested `bd.banglartesla.game`), version
code/name, adaptive icon (use `public/icons/maskable-512.png`), no sensitive permissions, and a
signed AAB. Nothing in this game needs location, contacts, camera, microphone or INTERNET.

---

## Route B — port to Godot (matches the original brief)

This is a real port, not a wrapper. Mapping of what already exists:

| This project | Godot 4.x equivalent |
|---|---|
| `src/vehicle/rickshawController.ts` (pure model) | `CharacterBody3D` with the same equations in `_physics_process`, or a `RigidBody3D` + custom velocity integration |
| `src/vehicle/rickshawModel.ts` | A `Node3D` scene with `MeshInstance3D`s (CSG/primitive meshes export fine) and an `AnimationPlayer`/script-driven rig |
| `src/world/city.ts` + `layout.ts` | A `Node3D` blockout with `GridMap` or merged `ArrayMesh` chunks; the layout data can be exported to JSON and read by a `@tool` builder |
| `src/world/textures.ts` | Same canvas-drawing logic ported to `Image` + `ImageTexture` (or bake the PNGs once and ship them) |
| `src/ai/traffic.ts` + `routes.ts` | `Path3D`/`Curve3D` loops + `NavigationAgent3D` or simple `MoveAndSlide` along the curve |
| `src/ui/*` + `styles.css` | `Control` scenes with a `Theme`; the design tokens map to theme colours and constants |
| `src/audio/audio.ts` | `AudioStreamGenerator` (or pre-rendered WAVs generated by the same synth), routed through named buses |
| `src/core/save.ts` | The same versioned JSON, written to `user://` with `FileAccess` |
| `src/core/i18n.ts` | Godot `Translation` + `tr()`, or keep the JSON and a small helper |
| `src/missions/*` | GDScript translation of the generator; resource-driven mission templates |

Target settings for the export preset: **Mobile renderer**, GL Compatibility fallback for older
devices, `arm64-v8a` (plus `armeabi-v7a` if you must support very old phones), no permissions,
`screen_orientation = landscape`, `immersive mode` on.

Recommended order if you port: driving model → camera → city blockout → one mission loop →
economy/save → UI → audio. Keep the tuned numbers in `src/core/config.ts`; they are engine-neutral
and were tested.

---

## What is missing to call this "Play-Store ready"

1. A signed AAB produced by a real build machine.
2. Real-device profiling on at least one low-end and one mid-range Android phone (frame time,
   thermals, memory, notch safe areas, back-button and app-pause behaviour).
3. Store assets (screenshots, feature graphic, short description in Bangla/English, privacy
   policy — the game collects nothing).
4. A licence review of the font (already OFL) and confirmation that the game title's "Tesla"
   joke is acceptable in your listing copy.
