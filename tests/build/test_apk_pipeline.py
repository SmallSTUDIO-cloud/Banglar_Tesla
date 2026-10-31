"""Offline guards for the checked-in Android packaging pipeline (not an APK test)."""
import importlib.util
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("banglar_build_apk", ROOT / "scripts" / "build-apk.py")
assert SPEC and SPEC.loader
apk = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = apk
SPEC.loader.exec_module(apk)


class PackagingGuards(unittest.TestCase):
    def test_identity_and_versions_remain_consistent(self):
        self.assertEqual(
            apk.read_config(),
            apk.AppConfig("com.shostalab.banglartesla", 24, 7, "0.6.0"),
        )

    def test_wrapper_is_complete_and_checksum_verified(self):
        self.assertEqual(apk.gradle_launcher(ROOT, {"PATH": ""}), ROOT / "android" / "gradlew")
        self.assertEqual(
            apk.hashlib.sha256((ROOT / "android/gradle/wrapper/gradle-wrapper.jar").read_bytes()).hexdigest(),
            apk.WRAPPER_JAR_SHA256,
        )

    def test_missing_and_conflicting_sdk_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            android = Path(directory)
            with self.assertRaisesRegex(apk.BuildError, "Android SDK not configured"):
                apk.sdk_path(android, {})
            with self.assertRaisesRegex(apk.BuildError, "different SDKs"):
                apk.sdk_path(android, {"ANDROID_HOME": directory, "ANDROID_SDK_ROOT": directory + "/other"})

    def test_absent_apk_never_counts_as_a_build(self):
        with tempfile.TemporaryDirectory() as directory:
            fake = Path(directory) / "app-debug.apk"
            tools = apk.Tools(Path(directory), fake, fake, fake, fake, fake)
            with self.assertRaisesRegex(apk.BuildError, "did not produce a nonempty debug APK"):
                apk.verify_apk(fake, tools, apk.read_config())

    def test_deployment_dotfile_is_not_an_android_asset_but_runtime_files_must_match(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            dist = base / "dist"
            dist.mkdir()
            (dist / "index.html").write_text("<html>current bundle</html>")
            (dist / ".nojekyll").write_text("deployment-only")
            bundle = base / "app-debug.apk"
            with zipfile.ZipFile(bundle, "w") as archive:
                for name in ("AndroidManifest.xml", "resources.arsc", "classes.dex"):
                    archive.writestr(name, "fixture")
                archive.writestr("assets/public/index.html", "<html>current bundle</html>")
            tools = apk.Tools(base, bundle, bundle, bundle, bundle, bundle)
            badging = ("package: name='com.shostalab.banglartesla' versionCode='7' versionName='0.6.0'\n"
                       "sdkVersion:'24'\ntargetSdkVersion:'34'\n")
            with patch.object(apk.subprocess, "run", return_value=apk.subprocess.CompletedProcess([], 0, badging)):
                apk.verify_apk(bundle, tools, apk.read_config(), dist)
                (dist / "index.html").write_text("stale")
                with self.assertRaisesRegex(apk.BuildError, "Missing or mismatched bundled web asset"):
                    apk.verify_apk(bundle, tools, apk.read_config(), dist)


if __name__ == "__main__":
    unittest.main()
