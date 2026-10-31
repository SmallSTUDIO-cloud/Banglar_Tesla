#!/usr/bin/env python3
"""Build and verify Banglar Tesla's debug APK using the checked-in Gradle project.

Only Android SDK tools and the Android Gradle Plugin perform packaging/signing.
`--check` validates prerequisites without running any APK build tasks.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANDROID = ROOT / "android"
APP_GRADLE = ANDROID / "app" / "build.gradle"
WEB_DIST = ROOT / "dist"
APK = ANDROID / "app" / "build" / "outputs" / "apk" / "debug" / "app-debug.apk"
BUILD_TOOLS_VERSION = "34.0.0"  # AGP 8.5.2's supported/default Build Tools revision
PLATFORM_API = 34
WRAPPER_JAR_SHA256 = "cb0da6751c2b753a16ac168bb354870ebb1e162e9083f116729cec9c781156b8"
GRADLE_DIST_SHA256 = "544c35d6bd849ae8a5ed0bcea39ba677dc40f49df7d1835561582da2009b961d"


class BuildError(Exception):
    """A missing prerequisite or failed APK verification (never a fake success)."""


@dataclass(frozen=True)
class AppConfig:
    application_id: str
    min_sdk: int
    version_code: int
    version_name: str


@dataclass(frozen=True)
class Tools:
    sdk: Path
    gradle: Path
    aapt: Path
    aapt2: Path
    apksigner: Path
    zipalign: Path


def read_config(root: Path = ROOT) -> AppConfig:
    """Read the authoritative Android Gradle defaultConfig; check other metadata."""
    text = (root / "android" / "app" / "build.gradle").read_text(encoding="utf-8")

    def value(name: str, pattern: str) -> str:
        matches = re.findall(rf"^\s*{name}\s+{pattern}\s*$", text, re.MULTILINE)
        if len(matches) != 1:
            raise BuildError(f"Expected exactly one {name} in android/app/build.gradle; found {len(matches)}")
        return matches[0]

    config = AppConfig(
        application_id=value("applicationId", r'["\']([^"\']+)["\']'),
        min_sdk=int(value("minSdk", r"(\d+)")),
        version_code=int(value("versionCode", r"(\d+)")),
        version_name=value("versionName", r'["\']([^"\']+)["\']'),
    )
    compile_sdk = int(value("compileSdk", r"(\d+)"))
    target_sdk = int(value("targetSdk", r"(\d+)"))
    namespace = value("namespace", r"['\"]([^'\"]+)['\"]")
    if namespace != config.application_id:
        raise BuildError(f"Android namespace {namespace} disagrees with applicationId {config.application_id}")
    if config != AppConfig("com.shostalab.banglartesla", 24, 7, "0.6.0") or compile_sdk != PLATFORM_API or target_sdk != PLATFORM_API:
        raise BuildError(f"Unexpected Android identity/version/SDK: {config}; compileSdk={compile_sdk}, targetSdk={target_sdk}")
    web_version = json.loads((root / "package.json").read_text(encoding="utf-8"))["version"]
    capacitor_id = json.loads((root / "capacitor.config.json").read_text(encoding="utf-8"))["appId"]
    if web_version != config.version_name or capacitor_id != config.application_id:
        raise BuildError("package.json version / capacitor.config.json appId disagree with android/app/build.gradle")
    return config


def sdk_path(android: Path = ANDROID, environ: dict[str, str] | None = None) -> Path:
    env = os.environ if environ is None else environ
    home = env.get("ANDROID_HOME")
    root = env.get("ANDROID_SDK_ROOT")
    if home and root and Path(home).expanduser().resolve() != Path(root).expanduser().resolve():
        raise BuildError("ANDROID_HOME and ANDROID_SDK_ROOT point to different SDKs; set both to the same official SDK")
    path = home or root
    if not path:
        local = android / "local.properties"
        if local.is_file():
            for line in local.read_text(encoding="utf-8").splitlines():
                if line.startswith("sdk.dir="):
                    path = line.split("=", 1)[1].replace("\\:", ":").replace("\\\\", "\\")
                    break
    if not path:
        raise BuildError("Android SDK not configured: set ANDROID_HOME (or ANDROID_SDK_ROOT), or android/local.properties sdk.dir")
    sdk = Path(path).expanduser().resolve()
    if not sdk.is_dir():
        raise BuildError(f"Android SDK directory not found: {sdk}")
    return sdk


def executable(directory: Path, name: str) -> Path:
    candidates = (directory / name, directory / f"{name}.exe", directory / f"{name}.bat")
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise BuildError(f"Official Android SDK Build Tools missing {name} in {directory}")



def gradle_launcher(root: Path = ROOT, environ: dict[str, str] | None = None) -> Path:
    """Use the checked-in, verified Gradle 8.7 wrapper; no silent fallback if partial."""
    env = os.environ if environ is None else environ
    wrapper_dir = root / "android"
    files = [
        wrapper_dir / "gradlew",
        wrapper_dir / "gradlew.bat",
        wrapper_dir / "gradle" / "wrapper" / "gradle-wrapper.jar",
        wrapper_dir / "gradle" / "wrapper" / "gradle-wrapper.properties",
    ]
    if any(path.exists() for path in files):
        missing = [str(path) for path in files if not path.is_file()]
        if missing:
            raise BuildError(f"Incomplete Gradle wrapper; missing: {', '.join(missing)}")
        digest = hashlib.sha256(files[2].read_bytes()).hexdigest()
        if digest != WRAPPER_JAR_SHA256:
            raise BuildError(f"Gradle wrapper JAR SHA-256 mismatch: {digest}")
        properties = files[3].read_text(encoding="utf-8")
        url = r"distributionUrl=https\://services.gradle.org/distributions/gradle-8.7-bin.zip"
        if url not in properties.splitlines() or f"distributionSha256Sum={GRADLE_DIST_SHA256}" not in properties.splitlines():
            raise BuildError("Gradle wrapper must pin the official Gradle 8.7 binary distribution and checksum")
        if os.name != "nt" and not os.access(files[0], os.X_OK):
            raise BuildError("android/gradlew is not executable (chmod +x android/gradlew)")
        return files[1] if os.name == "nt" else files[0]

    installed = shutil.which("gradle", path=env.get("PATH"))
    if not installed:
        raise BuildError("Gradle 8.7 required for AGP 8.5.2; restore the verified wrapper or install official Gradle 8.7")
    return Path(installed)


def check_toolchain(root: Path = ROOT, environ: dict[str, str] | None = None) -> Tools:
    env = os.environ if environ is None else environ
    sdk = sdk_path(root / "android", env)
    platform_jar = sdk / "platforms" / f"android-{PLATFORM_API}" / "android.jar"
    if not platform_jar.is_file():
        raise BuildError(f"Missing official Android SDK Platform {PLATFORM_API}: {platform_jar}")
    build_tools = sdk / "build-tools" / BUILD_TOOLS_VERSION
    aapt = executable(build_tools, "aapt")
    aapt2 = executable(build_tools, "aapt2")
    apksigner = executable(build_tools, "apksigner")
    zipalign = executable(build_tools, "zipalign")

    java_home = env.get("JAVA_HOME")
    bin_dir = Path(java_home) / "bin" if java_home else None
    java = next((p for p in (bin_dir / "java", bin_dir / "java.exe") if p.is_file()), None) if bin_dir else shutil.which("java")
    javac = next((p for p in (bin_dir / "javac", bin_dir / "javac.exe") if p.is_file()), None) if bin_dir else shutil.which("javac")
    if not java or not javac:
        raise BuildError("JDK 17 required: set JAVA_HOME to a JDK 17 installation with java and javac")
    version_result = subprocess.run([str(javac), "-version"], check=True, capture_output=True, text=True)
    version = version_result.stdout or version_result.stderr
    match = re.search(r"javac\s+(\d+)", version)
    if not match or int(match.group(1)) != 17:
        raise BuildError(f"Android Gradle Plugin 8.5.2 requires JDK 17; found {version.strip()}")
    runtime = subprocess.run([str(java), "-version"], check=True, capture_output=True, text=True)
    java_version = runtime.stdout or runtime.stderr
    runtime_match = re.search(r'(?:version\s+)?"(\d+)(?:[.\-+]|")', java_version)
    if not runtime_match or int(runtime_match.group(1)) != 17:
        raise BuildError(f"Gradle requires a JDK 17 runtime; found {java_version.strip()}")

    gradle = gradle_launcher(root, env)
    # Do not invoke Gradle in --check: wrapper may download a distribution.
    if not (root / "dist" / "index.html").is_file():
        raise BuildError("Missing dist/index.html; run npm run build before invoking Gradle")
    return Tools(sdk, Path(gradle), aapt, aapt2, apksigner, zipalign)


def verify_apk(apk: Path, tools: Tools, config: AppConfig, dist: Path = WEB_DIST) -> None:
    if not apk.is_file() or apk.stat().st_size == 0:
        raise BuildError(f"Gradle did not produce a nonempty debug APK at {apk}")
    subprocess.run([str(tools.zipalign), "-c", "-p", "4", str(apk)], check=True)
    subprocess.run([str(tools.apksigner), "verify", "--verbose", "--print-certs", str(apk)], check=True)
    badging = subprocess.run([str(tools.aapt), "dump", "badging", str(apk)], check=True, capture_output=True, text=True).stdout
    expected = (
        f"name='{config.application_id}'",
        f"versionCode='{config.version_code}'",
        f"versionName='{config.version_name}'",
        f"sdkVersion:'{config.min_sdk}'",
        f"targetSdkVersion:'{PLATFORM_API}'",
    )
    if any(part not in badging for part in expected):
        raise BuildError(f"APK metadata does not match Gradle: expected {expected}; got:\n{badging[:1500]}")
    with zipfile.ZipFile(apk) as bundle:
        names = set(bundle.namelist())
        for entry in ("AndroidManifest.xml", "resources.arsc", "classes.dex", "assets/public/index.html"):
            if entry not in names:
                raise BuildError(f"APK missing {entry}")
        # Vite copies static dotfiles such as .nojekyll for GitHub Pages.
        # Android Gradle packaging excludes hidden assets; they are not WebView
        # runtime resources and must not make a correctly packaged APK fail.
        files = [p for p in dist.rglob("*") if p.is_file() and
                 not any(part.startswith(".") for part in p.relative_to(dist).parts)]
        if not files:
            raise BuildError(f"Web bundle is empty: {dist}")
        for source in files:
            entry = "assets/public/" + source.relative_to(dist).as_posix()
            if entry not in names or bundle.read(entry) != source.read_bytes():
                raise BuildError(f"Missing or mismatched bundled web asset: {entry}")
    print(f"Verified debug APK: {apk} ({apk.stat().st_size:,} bytes)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="check official toolchain and web bundle without compiling an APK")
    args = parser.parse_args()
    try:
        config = read_config()
        tools = check_toolchain()
        print(f"Android SDK: {tools.sdk}; Gradle: {tools.gradle}; JDK 17; app: {config}")
        if args.check:
            return 0
        subprocess.run([str(tools.gradle), "-p", str(ANDROID), ":app:assembleDebug"], check=True)
        verify_apk(APK, tools, config)
        return 0
    except (BuildError, subprocess.CalledProcessError) as error:
        print(f"Android build pipeline: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
