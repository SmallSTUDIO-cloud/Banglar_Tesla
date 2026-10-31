# Android debug APK — authoritative Gradle pipeline

The checked-in `android/` project is a native, offline **Android WebView** host, not a generated Capacitor Android project. `capacitor.config.json` describes the web app's ID/origin; do **not** run `npx cap add android` or `npx cap sync android` over this project. The retired hand-assembly logic in `scripts/build-apk.py` is now a standard-library-only **Gradle launcher, toolchain preflight and post-build verifier**. It does not supply, download, or substitute Android binaries. Android Gradle Plugin (AGP) performs resource compilation, DEX, alignment, and debug signing using the official Android SDK.

## Prerequisites on a trusted build machine or CI runner

| Component | Required version / location |
|---|---|
| Java | **JDK 17** (`JAVA_HOME` recommended, including `bin/java` and `bin/javac`). Source/target compatibility for the app's Java files remains Java 11. |
| Gradle | **Gradle 8.7**, compatible with the checked-in **AGP 8.5.2** in `android/build.gradle`. The complete verified wrapper in `android/` is the recommended launcher; no system Gradle installation is required. |
| Android SDK | Official **Android SDK Platform 34** (`platforms/android-34/android.jar`) and **SDK Build Tools 34.0.0** (`build-tools/34.0.0/{aapt,aapt2,apksigner,zipalign}`). Platform Tools/`adb` are needed only for on-device validation. |
| Node/Python | Node/npm as used by the web project, npm dependencies from `npm ci`, and Python 3.10+ for the preflight/verifier (no third-party Python modules). |

Install the SDK using Android Studio's SDK Manager or Google's official `sdkmanager` on a machine with access to Google's Android SDK repository; accept the relevant Android SDK licenses according to your organization's policy. For example, after installing the official command-line tools:

```sh
export JAVA_HOME=/absolute/path/to/jdk-17
export ANDROID_HOME=/absolute/path/to/Android/Sdk
export ANDROID_SDK_ROOT="$ANDROID_HOME"  # optional legacy alias, if set must match
export PATH="$JAVA_HOME/bin:$PATH"          # wrapper supplies Gradle 8.7 on first use
sdkmanager --sdk_root="$ANDROID_HOME" "platforms;android-34" "build-tools;34.0.0" "platform-tools"
sdkmanager --sdk_root="$ANDROID_HOME" --licenses
```

Android Studio's ignored `android/local.properties` containing `sdk.dir=/absolute/path/to/Android/Sdk` is also supported. Do not commit an SDK path, license file, keystore, or generated APK. The build preflight rejects conflicting `ANDROID_HOME` / `ANDROID_SDK_ROOT` locations and reports missing SDK components. `python3 scripts/build-apk.py --check` runs **only** the prerequisite and wrapper integrity checks after the web build; it does **not** execute Gradle, download its distribution, or compile an APK. On this sandbox it reports an absent SDK and no APK has been built.

## Complete Gradle 8.7 wrapper and provenance

The four checked-in files `android/gradlew` (executable), `android/gradlew.bat`, `android/gradle/wrapper/gradle-wrapper.jar`, and `android/gradle/wrapper/gradle-wrapper.properties` form a **complete wrapper**. The launch scripts and JAR came directly from the official [`gradle/gradle` `v8.7.0` tag](https://github.com/gradle/gradle/tree/v8.7.0), rather than from a third-party binary or a wrapper reconstructed by hand. The JAR's SHA-256 is `cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8`, matching [Gradle's published wrapper checksum](https://gradle.org/release-checksums/#8.7). The tagged upstream project's own wrapper properties refer to an 8.7 release candidate; **this project's** properties instead point to the *final* official `https://services.gradle.org/distributions/gradle-8.7-bin.zip`, pinned by `distributionSha256Sum=544c35d6bd849ae8a5ed0bcea39ba677dc40f49df7d1835561582da2009b961d` ([official distribution checksum](https://gradle.org/release-checksums/#8.7)). The launcher verifies the checked-in JAR checksum and distribution pin before building. AGP 8.5.2's [official compatibility table](https://developer.android.com/build/releases/past-releases/agp-8-5-0-release-notes) specifies Gradle 8.7, JDK 17 and Build Tools 34.0.0.

This sandbox **did not run `gradle wrapper`**: no JDK or installed Gradle is available. The wrapper files are the official Gradle-generated files at the verified release tag; this is *not* evidence that this Android app compiled. On a trusted machine/CI, the first `./gradlew` invocation downloads the *official pinned Gradle distribution*. Its checksum is checked before use. That download and Android plugin resolution require network access to Gradle and Google's Maven/SDK repositories; the present sandbox cannot reach them. Do not override the distribution URL with an unverified mirror.

## Build and output

From the repository root:

```sh
npm ci
npm run build:apk    # builds web bundle, runs android/gradlew :app:assembleDebug, verifies APK
```

`npm run build:apk` runs TypeScript/Vite first, then `scripts/build-apk.py`, which invokes the **existing Gradle project** using `android/gradlew -p android :app:assembleDebug` (or `gradlew.bat` on Windows). From `android/`, the equivalent direct task is `./gradlew :app:assembleDebug` after `npm run build` at the repository root; the npm command additionally performs APK verification. The `syncWebDist` Gradle task syncs the current `dist/` to the ignored `android/app/src/main/assets/public/` and rejects a missing `dist/index.html`. The launcher checks the generated package metadata, signature, alignment, and byte-for-byte bundled web assets before reporting success.

**Expected APK:** `android/app/build/outputs/apk/debug/app-debug.apk`. This is a **debug-signed** installable APK, *not* a release-signed Play Store build. No copy is produced in `artifacts/` by this pipeline. A release build requires a distinct, securely managed release signing configuration; the `release` build type no longer uses the debug signing key.

`android/app/build.gradle` is the native metadata source of truth: `applicationId`/`namespace` **com.shostalab.banglartesla**, `versionCode` **7**, `versionName` **0.6.0**, `minSdk` **24**, `targetSdk`/`compileSdk` **34**. AGP writes those values into the merged APK manifest; the source `AndroidManifest.xml` no longer duplicates them. The launcher checks `package.json` version and `capacitor.config.json` appId against Gradle and rejects drift rather than silently downgrading the version.

## Independent verification on the trusted build machine

Run these using tools from the **official** Android SDK Build Tools 34.0.0, after a successful Gradle build:

```sh
APK=android/app/build/outputs/apk/debug/app-debug.apk
BT="$ANDROID_HOME/build-tools/34.0.0"
test -s "$APK"
"$BT/aapt" dump badging "$APK" | grep -E "^package:|^sdkVersion:|^targetSdkVersion:"
"$BT/apksigner" verify --verbose --print-certs "$APK"
"$BT/zipalign" -c -p 4 "$APK"
unzip -l "$APK" | grep -E 'AndroidManifest.xml|classes.dex|assets/public/index.html'
sha256sum "$APK"
```

Confirm that badging says `name='com.shostalab.banglartesla' versionCode='7' versionName='0.6.0'` and `sdkVersion:'24'`. To validate on a **real** Android device (not done in this sandbox), use a trusted device with developer mode enabled and official Platform Tools:

```sh
"$ANDROID_HOME/platform-tools/adb" install -r "$APK"
"$ANDROID_HOME/platform-tools/adb" shell monkey -p com.shostalab.banglartesla 1
```

The repository's `npm run test:android-pipeline` uses only source/config and preflight tests; it does not install an SDK or produce an APK. The normal web typecheck, build and unit tests remain separate.
