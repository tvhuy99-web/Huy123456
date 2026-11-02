#!/usr/bin/env python3
"""Validate a self-contained SillyTavern 1.19.0 Android build before Gradle."""
import json
import struct
import zipfile
import re
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parent.parent
assets = root / "app/src/main/assets"
binary = root / "app/src/main/jniLibs/arm64-v8a/libnode.so"
st_zip = assets / "sillytavern.zip"
libs_zip = assets / "nodelibs.zip"

if not binary.is_file() or binary.stat().st_size < 1_000_000:
    raise SystemExit("Missing Android Node.js ARM64 binary")
with binary.open("rb") as source:
    header = source.read(20)
if not (header.startswith(b"\x7fELF") and header[4] == 2 and struct.unpack_from("<H", header, 18)[0] == 183):
    raise SystemExit("Node binary must be ELF64 for AArch64")

with zipfile.ZipFile(st_zip) as archive:
    names = set(archive.namelist())
    required = {"server.js", "package.json"}
    if not required.issubset(names):
        raise SystemExit(f"Missing SillyTavern runtime files: {required - names}")
    package = json.loads(archive.read("package.json"))
    if package.get("version") != "1.19.0":
        raise SystemExit(f"Incorrect SillyTavern version: {package.get('version')}")
    if not any(name.startswith("node_modules/") for name in names):
        raise SystemExit("node_modules not present in SillyTavern archive")
    if not any(name.startswith("public/") for name in names):
        raise SystemExit("SillyTavern browser UI absent")
    print(f"SillyTavern {package['version']} validated: {len(names):,} archive entries")

with zipfile.ZipFile(libs_zip) as archive:
    libraries = archive.namelist()
    if len(libraries) < 4:
        raise SystemExit("Not enough bundled Node.js Android libraries")
    if "libffi.so" not in libraries:
        raise SystemExit("libffi.so missing: Node.js will fail to start on Android")
    # Check the actual DT_NEEDED dependencies of Node and bundled libraries.
    # This catches libffi and future Termux dependency changes *before* APK
    # compilation, instead of discovering them from the on-device error screen.
    android_system = {
        "libc.so", "libm.so", "libdl.so", "liblog.so", "libandroid.so",
        "libz.so", "libstdc++.so", "libEGL.so", "libGLESv2.so",
        "libjnigraphics.so", "libvulkan.so", "libmediandk.so",
    }
    supplied = set(libraries)
    with tempfile.TemporaryDirectory() as tmp:
        missing = {}
        inputs = [binary]
        for name in libraries:
            if not name.endswith(".so") and ".so." not in name:
                continue
            dest = Path(tmp) / name
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(archive.read(name))
            inputs.append(dest)
        for target in inputs:
            result = subprocess.run(
                ["readelf", "-d", str(target)],
                text=True, capture_output=True, check=True,
            )
            needed = re.findall(r"\\(NEEDED\\).*?\\[(.*?)\\]", result.stdout)
            unknown = sorted(set(needed) - supplied - android_system)
            if unknown:
                missing[target.name] = unknown
        if missing:
            raise SystemExit(f"Missing Android native DT_NEEDED libraries: {missing}")
    print(f"Bundled Android Node.js libraries: {len(libraries)}")
    print("ELF dynamic dependency closure: OK (including libffi.so)")

print(f"AArch64 Node.js binary: {binary.stat().st_size / 1024**2:.1f} MiB")
print("Preview bundle verified. Note: native tokenizer compatibility needs real-device testing.")
