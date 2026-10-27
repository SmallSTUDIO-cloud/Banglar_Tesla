#!/usr/bin/env python3
"""
Builds and verifies the installable debug-signed Android APK for Banglar Tesla:
  - Package ID: com.shostalab.banglartesla
  - App Name:   Banglar Tesla
  - Screen:     sensorLandscape, immersive fullscreen
  - Assets:     Vite production bundle (dist/ -> assets/public/), 100% offline
  - Signing:    Standard Android debug key (APK Signature Scheme v1 + v2 + v3)
"""

from __future__ import annotations

import hashlib
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT / "dist"
ANDROID_MAIN = ROOT / "android" / "app" / "src" / "main"
RES_DIR = ANDROID_MAIN / "res"
JAVA_DIR = ANDROID_MAIN / "java"
SMALI_DIR = ANDROID_MAIN / "smali"
ASSETS_DIR = ANDROID_MAIN / "assets"
PUBLIC_ASSETS_DIR = ASSETS_DIR / "public"
ARTIFACTS_DIR = ROOT / "artifacts"
OUT_APK = ARTIFACTS_DIR / "banglar-tesla-v0.6.0-debug.apk"
STABLE_APK = ARTIFACTS_DIR / "Banglar-Tesla.apk"

TOOLS_DIR = Path("/tmp/android-tools")
AAPT2 = TOOLS_DIR / "node_modules" / "aaptjs3" / "bin" / "x64" / "linux" / "aapt2"
APKTOOL_JAR = TOOLS_DIR / "node_modules" / "@postar" / "apktool-node" / "lib" / "apktool.jar"
APKSIGNER_JAR = TOOLS_DIR / "node_modules" / "@postar" / "apktool-node" / "lib" / "apksigner.jar"
D8_JAR = TOOLS_DIR / "node_modules" / "d8-termux" / "d8.jar"
ANDROID_JAR = TOOLS_DIR / "android-34.jar"
DEBUG_KEYSTORE = Path("/tmp/banglar-tesla-debug.keystore")


def find_java_home() -> Path:
    import jdk4py  # type: ignore
    return Path(jdk4py.JAVA_HOME)


def generate_icons() -> None:
    from PIL import Image  # type: ignore

    icon_src = ROOT / "public" / "icons" / "icon-512.png"
    mask_src = ROOT / "public" / "icons" / "maskable-512.png"
    assert icon_src.exists(), f"Missing {icon_src}"
    assert mask_src.exists(), f"Missing {mask_src}"

    densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    with Image.open(icon_src) as img:
        rgba = img.convert("RGBA")
        for folder, size in densities.items():
            out_dir = RES_DIR / folder
            out_dir.mkdir(parents=True, exist_ok=True)
            resized = rgba.resize((size, size), Image.Resampling.LANCZOS)
            resized.save(out_dir / "ic_launcher.png", format="PNG", optimize=True)

    # Adaptive icon foreground (108dp * 4 = 432px with safe inset)
    fg_dir = RES_DIR / "drawable-nodpi"
    fg_dir.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGBA", (432, 432), (0, 0, 0, 0))
    with Image.open(mask_src) as mimg:
        inner = mimg.convert("RGBA").resize((288, 288), Image.Resampling.LANCZOS)
        canvas.paste(inner, ((432 - 288) // 2, (432 - 288) // 2), inner)
    canvas.save(fg_dir / "ic_launcher_foreground.png", format="PNG", optimize=True)


def sync_web_dist() -> list[Path]:
    if not (DIST_DIR / "index.html").exists():
        raise RuntimeError("dist/index.html missing — run `npm run build` first.")
    if PUBLIC_ASSETS_DIR.exists():
        shutil.rmtree(PUBLIC_ASSETS_DIR)
    PUBLIC_ASSETS_DIR.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(DIST_DIR, PUBLIC_ASSETS_DIR)
    for dotfile in list(PUBLIC_ASSETS_DIR.rglob(".*")):
        if dotfile.is_file():
            dotfile.unlink()
    files = sorted(p.relative_to(PUBLIC_ASSETS_DIR) for p in PUBLIC_ASSETS_DIR.rglob("*") if p.is_file())
    print(f"[apk] Synced {len(files)} production web files from dist/ -> assets/public/")
    return files


def assemble_or_compile_dex(java_home: Path, gen_dir: Path, base_apk: Path, out_dex: Path, work_dir: Path) -> None:
    """Uses javac+d8 when full JDK is installed, or Google Smali 3.0.3 when running under JRE."""
    javac_bin = java_home / "bin" / "javac"
    java_bin = java_home / "bin" / "java"
    if javac_bin.exists() and D8_JAR.exists():
        classes_dir = work_dir / "classes"
        dex_dir = work_dir / "dex"
        classes_dir.mkdir(parents=True, exist_ok=True)
        dex_dir.mkdir(parents=True, exist_ok=True)
        java_sources = sorted(JAVA_DIR.rglob("*.java"))
        if gen_dir.exists():
            java_sources.extend(sorted(gen_dir.rglob("*.java")))
        subprocess.run(
            [
                str(javac_bin),
                "--release",
                "11",
                "-classpath",
                str(ANDROID_JAR),
                "-d",
                str(classes_dir),
                *[str(p) for p in java_sources],
            ],
            check=True,
        )
        class_files = sorted(classes_dir.rglob("*.class"))
        subprocess.run(
            [
                str(java_bin),
                "-cp",
                str(D8_JAR),
                "com.android.tools.r8.D8",
                "--min-api",
                "24",
                "--lib",
                str(ANDROID_JAR),
                "--output",
                str(dex_dir),
                *[str(p) for p in class_files],
            ],
            check=True,
        )
        shutil.copy2(dex_dir / "classes.dex", out_dex)
        print(f"[apk] Compiled {len(java_sources)} Java sources -> classes.dex ({out_dex.stat().st_size} bytes)")
        return

    apktool_proj = work_dir / "smali_proj"
    (apktool_proj / "smali").mkdir(parents=True, exist_ok=True)
    for sf in SMALI_DIR.rglob("*.smali"):
        rel = sf.relative_to(SMALI_DIR)
        dest = apktool_proj / "smali" / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(sf, dest)
    with zipfile.ZipFile(base_apk, "r") as zf:
        (apktool_proj / "AndroidManifest.xml").write_bytes(zf.read("AndroidManifest.xml"))
    (apktool_proj / "apktool.yml").write_text(
        "version: 2.9.3\n"
        "apkFileName: temp.apk\n"
        "isFrameworkApk: false\n"
        "sdkInfo:\n"
        "  minSdkVersion: 24\n"
        "  targetSdkVersion: 34\n",
        encoding="utf-8",
    )
    temp_apk = work_dir / "smali_only.apk"
    subprocess.run(
        [
            str(java_bin),
            "-jar",
            str(APKTOOL_JAR),
            "b",
            "-r",
            "-o",
            str(temp_apk),
            str(apktool_proj),
        ],
        check=True,
    )
    with zipfile.ZipFile(temp_apk, "r") as zf:
        out_dex.write_bytes(zf.read("classes.dex"))
    print(f"[apk] Assembled smali -> classes.dex ({out_dex.stat().st_size} bytes)")


def parse_classfile_methods_and_fields(data: bytes) -> tuple[str, str | None, list[str], set[tuple[str, str]], set[tuple[str, str]]]:
    """Minimal JVM classfile constant-pool parser to verify Android SDK API signatures."""
    magic, _minor, _major, cp_count = struct.unpack(">IHHH", data[:10])
    assert magic == 0xCAFEBABE
    pos = 10
    cp: list[object] = [None] * cp_count
    i = 1
    while i < cp_count:
        tag = data[pos]
        pos += 1
        if tag == 1:  # Utf8
            ln = struct.unpack(">H", data[pos : pos + 2])[0]
            pos += 2
            cp[i] = data[pos : pos + ln].decode("utf-8", errors="replace")
            pos += ln
        elif tag in (7, 8, 16, 19, 20):  # Class, String, MethodType, Module, Package
            cp[i] = struct.unpack(">H", data[pos : pos + 2])[0]
            pos += 2
        elif tag in (3, 4):  # Int, Float
            pos += 4
        elif tag in (5, 6):  # Long, Double
            pos += 8
            i += 1
        elif tag in (9, 10, 11, 12, 17, 18):  # Refs, NameAndType, InvokeDynamic
            cp[i] = struct.unpack(">HH", data[pos : pos + 4])
            pos += 4
        elif tag == 15:  # MethodHandle
            pos += 3
        else:
            raise ValueError(f"Unknown CP tag {tag}")
        i += 1

    def cls_name(idx: int) -> str | None:
        if idx == 0:
            return None
        name_idx = cp[idx]
        assert isinstance(name_idx, int)
        return str(cp[name_idx])

    _access, this_idx, super_idx, iface_count = struct.unpack(">HHHH", data[pos : pos + 8])
    pos += 8
    this_cls = cls_name(this_idx) or ""
    super_cls = cls_name(super_idx)
    ifaces: list[str] = []
    for _ in range(iface_count):
        if_idx = struct.unpack(">H", data[pos : pos + 2])[0]
        pos += 2
        nm = cls_name(if_idx)
        if nm:
            ifaces.append(nm)

    fields: set[tuple[str, str]] = set()
    field_count = struct.unpack(">H", data[pos : pos + 2])[0]
    pos += 2
    for _ in range(field_count):
        _facc, fn_idx, fd_idx, attr_c = struct.unpack(">HHHH", data[pos : pos + 8])
        pos += 8
        fields.add((str(cp[fn_idx]), str(cp[fd_idx])))
        for _a in range(attr_c):
            _an, alen = struct.unpack(">HI", data[pos : pos + 6])
            pos += 6 + alen

    methods: set[tuple[str, str]] = set()
    method_count = struct.unpack(">H", data[pos : pos + 2])[0]
    pos += 2
    for _ in range(method_count):
        _macc, mn_idx, md_idx, attr_c = struct.unpack(">HHHH", data[pos : pos + 8])
        pos += 8
        methods.add((str(cp[mn_idx]), str(cp[md_idx])))
        for _a in range(attr_c):
            _an, alen = struct.unpack(">HI", data[pos : pos + 6])
            pos += 6 + alen

    return this_cls, super_cls, ifaces, methods, fields


def verify_dex_against_android_jar(dex_path: Path) -> None:
    from loguru import logger  # type: ignore

    logger.disable("androguard")
    from androguard.core.dex import DEX  # type: ignore

    dex = DEX(dex_path.read_bytes())
    internal_classes: dict[str, tuple[str | None, list[str], set[tuple[str, str]], set[tuple[str, str]]]] = {}
    for cls in dex.get_classes():
        cname = cls.get_name()[1:-1]
        sname = cls.get_superclassname()[1:-1] if cls.get_superclassname() else None
        ifaces = [itf[1:-1] for itf in cls.get_interfaces()]
        mset = {(m.get_name(), m.get_descriptor().replace(" ", "")) for m in cls.get_methods()}
        fset = {(f.get_name(), f.get_descriptor()) for f in cls.get_fields()}
        internal_classes[cname] = (sname, ifaces, mset, fset)

    with zipfile.ZipFile(ANDROID_JAR, "r") as jar:
        cache: dict[str, tuple[str | None, list[str], set[tuple[str, str]], set[tuple[str, str]]]] = {}

        def load_cls(cname: str):
            if cname in internal_classes:
                return internal_classes[cname]
            if cname not in cache:
                entry = f"{cname}.class"
                assert entry in jar.namelist(), f"Missing SDK class {cname} in android-34.jar"
                _, sup, ifs, ms, fs = parse_classfile_methods_and_fields(jar.read(entry))
                cache[cname] = (sup, ifs, ms, fs)
            return cache[cname]

        def has_method(cname: str, name: str, desc: str) -> bool:
            sup, ifs, ms, _ = load_cls(cname)
            if (name, desc) in ms:
                return True
            if name != "<init>" and sup and has_method(sup, name, desc):
                return True
            for itf in ifs:
                if has_method(itf, name, desc):
                    return True
            return False

        def has_field(cname: str, name: str, desc: str) -> bool:
            sup, ifs, _, fs = load_cls(cname)
            if (name, desc) in fs:
                return True
            if sup and has_field(sup, name, desc):
                return True
            for itf in ifs:
                if has_field(itf, name, desc):
                    return True
            return False

        checked_calls = 0
        for cls in dex.get_classes():
            for m in cls.get_methods():
                code = m.get_code()
                if not code:
                    continue
                bc = code.get_bc()
                for ins in bc.get_instructions():
                    out = ins.get_output()
                    op = ins.get_name()
                    if op.startswith("invoke-"):
                        ref = out.split(",")[-1].strip()
                        owner_part, rest = ref.split("->")
                        owner = owner_part[1:-1]
                        mname, mdesc = rest.split("(", 1)
                        mdesc = "(" + mdesc.replace(" ", "")
                        assert has_method(owner, mname, mdesc), f"Unresolved method {owner}->{mname}{mdesc} in {m.get_name()}"
                        checked_calls += 1
                    elif op.startswith(("iget", "iput", "sget", "sput")):
                        ref = out.split(",")[-1].strip()
                        owner_part, rest = ref.split("->")
                        owner = owner_part[1:-1]
                        fname, fdesc = rest.replace(":", " ").split()
                        assert has_field(owner, fname, fdesc), f"Unresolved field {owner}->{fname}:{fdesc} in {m.get_name()}"
                        checked_calls += 1

    print(f"[apk] Verified all {len(internal_classes)} DEX classes and {checked_calls} bytecode SDK/method/field references against android-34.jar")


def write_4byte_aligned_apk(base_apk: Path, classes_dex: Path, out_unsigned_apk: Path) -> None:
    """
    Repacks base_apk + classes.dex so every uncompressed (ZIP_STORED) entry —
    specifically resources.arsc and raw media/font/png assets — starts on an
    exact 4-byte boundary (required for targetSdkVersion >= 30 on Android 11-15).
    """
    entries: list[tuple[str, bytes, int]] = []
    with zipfile.ZipFile(base_apk, "r") as zin:
        for info in zin.infolist():
            if info.filename.startswith("META-INF/"):
                continue
            data = zin.read(info.filename)
            compress_type = info.compress_type
            if info.filename == "resources.arsc":
                compress_type = zipfile.ZIP_STORED
            entries.append((info.filename, data, compress_type))

    # Place classes.dex right after AndroidManifest.xml / resources.arsc
    entries.append(("classes.dex", classes_dex.read_bytes(), zipfile.ZIP_DEFLATED))

    with zipfile.ZipFile(out_unsigned_apk, "w") as zout:
        for filename, data, compress_type in entries:
            zinfo = zipfile.ZipInfo(filename=filename, date_time=(2026, 1, 1, 0, 0, 0))
            zinfo.compress_type = compress_type
            zinfo.create_system = 3
            zinfo.external_attr = 0o644 << 16
            if compress_type == zipfile.ZIP_STORED:
                # Local file header size is 30 + len(filename_bytes) + len(extra)
                offset = zout.fp.tell()  # type: ignore[union-attr]
                fname_len = len(filename.encode("utf-8"))
                data_start = offset + 30 + fname_len
                pad = (4 - (data_start % 4)) % 4
                zinfo.extra = b"\x00" * pad
                zout.writestr(zinfo, data, compress_type=zipfile.ZIP_STORED)
            else:
                zinfo.extra = b""
                zout.writestr(zinfo, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def verify_zip_alignment(apk_path: Path) -> None:
    raw = apk_path.read_bytes()
    with zipfile.ZipFile(apk_path, "r") as zf:
        found_arsc = False
        for info in zf.infolist():
            off = info.header_offset
            sig, _ver, _flags, _comp, _t, _d, _crc, _csz, _usz, fn_len, ex_len = struct.unpack(
                "<IHHHHHIIIHH", raw[off : off + 30]
            )
            assert sig == 0x04034B50
            data_offset = off + 30 + fn_len + ex_len
            if info.filename == "resources.arsc":
                found_arsc = True
                assert info.compress_type == zipfile.ZIP_STORED, "resources.arsc MUST be uncompressed (ZIP_STORED)"
                assert data_offset % 4 == 0, f"resources.arsc misaligned: offset={data_offset}"
            elif info.compress_type == zipfile.ZIP_STORED:
                assert data_offset % 4 == 0, f"Stored entry {info.filename} misaligned: offset={data_offset}"
        assert found_arsc, "resources.arsc missing from APK"
    print("[apk] Verified 4-byte zipalign compliance on resources.arsc and all uncompressed entries")


def ensure_debug_keystore(keytool_bin: Path) -> None:
    if DEBUG_KEYSTORE.exists():
        return
    subprocess.run(
        [
            str(keytool_bin),
            "-genkeypair",
            "-v",
            "-keystore",
            str(DEBUG_KEYSTORE),
            "-storepass",
            "android",
            "-alias",
            "androiddebugkey",
            "-keypass",
            "android",
            "-keyalg",
            "RSA",
            "-keysize",
            "2048",
            "-validity",
            "10950",
            "-dname",
            "CN=Android Debug,O=Android,C=US",
        ],
        check=True,
    )


def build_and_verify() -> None:
    assert AAPT2.exists(), f"Missing aapt2 at {AAPT2}"
    assert APKTOOL_JAR.exists(), f"Missing apktool.jar at {APKTOOL_JAR}"
    assert APKSIGNER_JAR.exists(), f"Missing apksigner.jar at {APKSIGNER_JAR}"
    assert D8_JAR.exists(), f"Missing d8.jar at {D8_JAR}"
    assert ANDROID_JAR.exists(), f"Missing android-34.jar at {ANDROID_JAR}"

    java_home = find_java_home()
    java_bin = java_home / "bin" / "java"
    keytool_bin = java_home / "bin" / "keytool"
    os.chmod(AAPT2, 0o755)

    generate_icons()
    dist_files = sync_web_dist()
    ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="bt-apk-") as tmp:
        work = Path(tmp)
        compiled_res = work / "compiled_res.zip"
        gen_dir = work / "gen"
        gen_dir.mkdir(parents=True, exist_ok=True)
        base_apk = work / "base.apk"
        classes_dex = work / "classes.dex"
        unsigned_aligned = work / "unsigned-aligned.apk"

        # 1. Compile resources with aapt2
        subprocess.run(
            [str(AAPT2), "compile", "--dir", str(RES_DIR), "-o", str(compiled_res)],
            check=True,
        )

        # 2. Link resources + AndroidManifest.xml + assets/public/ with aapt2
        subprocess.run(
            [
                str(AAPT2),
                "link",
                "-o",
                str(base_apk),
                "-I",
                str(ANDROID_JAR),
                "--manifest",
                str(ANDROID_MAIN / "AndroidManifest.xml"),
                "-A",
                str(ASSETS_DIR),
                "--java",
                str(gen_dir),
                "--min-sdk-version",
                "24",
                "--target-sdk-version",
                "34",
                "--version-code",
                "5",
                "--version-name",
                "0.6.0",
                "-0",
                ".ttf",
                "-0",
                ".png",
                "-0",
                ".jpg",
                "-0",
                ".webp",
                "-0",
                ".mp3",
                "-0",
                ".ogg",
                "-0",
                ".wav",
                "--auto-add-overlay",
                str(compiled_res),
            ],
            check=True,
        )

        # 3. Assemble/compile & verify classes.dex against android-34.jar
        assemble_or_compile_dex(java_home, gen_dir, base_apk, classes_dex, work)
        verify_dex_against_android_jar(classes_dex)

        # 4. Merge & 4-byte align
        write_4byte_aligned_apk(base_apk, classes_dex, unsigned_aligned)
        verify_zip_alignment(unsigned_aligned)

        # 5. Sign with standard Android debug key (v1 + v2 + v3)
        ensure_debug_keystore(keytool_bin)
        if OUT_APK.exists():
            OUT_APK.unlink()
        subprocess.run(
            [
                str(java_bin),
                "-jar",
                str(APKSIGNER_JAR),
                "sign",
                "--ks",
                str(DEBUG_KEYSTORE),
                "--ks-key-alias",
                "androiddebugkey",
                "--ks-pass",
                "pass:android",
                "--key-pass",
                "pass:android",
                "--min-sdk-version",
                "24",
                "--max-sdk-version",
                "34",
                "--v1-signing-enabled",
                "true",
                "--v2-signing-enabled",
                "true",
                "--v3-signing-enabled",
                "true",
                "--out",
                str(OUT_APK),
                str(unsigned_aligned),
            ],
            check=True,
        )

        shutil.copy2(OUT_APK, STABLE_APK)

    # 6. Post-sign verification suite
    verify_zip_alignment(OUT_APK)
    sig_verify = subprocess.run(
        [
            str(java_bin),
            "-jar",
            str(APKSIGNER_JAR),
            "verify",
            "--verbose",
            "--print-certs",
            "--min-sdk-version",
            "24",
            str(OUT_APK),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    print(sig_verify.stdout.strip())

    badging = subprocess.run(
        [str(AAPT2), "dump", "badging", str(OUT_APK)],
        check=True,
        capture_output=True,
        text=True,
    )
    print(badging.stdout.strip())
    assert "versionCode='7'" in badging.stdout and "versionName='0.6.0'" in badging.stdout, (
        "APK badging version mismatch: expected versionCode='7' versionName='0.6.0'"
    )

    # 7. Byte-for-byte asset verification inside signed APK
    with zipfile.ZipFile(OUT_APK, "r") as zf:
        names = set(zf.namelist())
        assert "AndroidManifest.xml" in names
        assert "resources.arsc" in names
        assert "classes.dex" in names
        for rel in dist_files:
            apk_entry = f"assets/public/{rel.as_posix()}"
            assert apk_entry in names, f"Missing web asset in APK: {apk_entry}"
            assert zf.read(apk_entry) == (DIST_DIR / rel).read_bytes(), f"Byte mismatch for {apk_entry}"

    sha256 = hashlib.sha256(OUT_APK.read_bytes()).hexdigest()
    size_bytes = OUT_APK.stat().st_size
    print(f"\n[apk] SUCCESS: {OUT_APK} + {STABLE_APK}")
    print(f"[apk] Size:    {size_bytes:,} bytes ({size_bytes / (1024 * 1024):.2f} MB)")
    print(f"[apk] SHA256:  {sha256}")


if __name__ == "__main__":
    build_and_verify()
