#!/usr/bin/env python3
"""Read-only product-version gate; helper/service protocol versions are independent."""

import argparse
import json
from pathlib import Path
import re
import tomllib


def desktop_versions(root: Path) -> dict[str, str]:
    app = root / "apps/windows/app"
    versions = {
        "Windows package.json": json.loads((app / "package.json").read_text())["version"],
        "Windows tauri.conf.json": json.loads(
            (app / "src-tauri/tauri.conf.json").read_text()
        )["version"],
        "Windows Cargo.toml": tomllib.loads(
            (app / "src-tauri/Cargo.toml").read_text()
        )["package"]["version"],
    }
    locked = [
        p["version"] for p in tomllib.loads((app / "Cargo.lock").read_text())["package"]
        if p["name"] == "tono-windows" and "source" not in p
    ]
    if len(locked) != 1:
        raise ValueError("Cargo.lock must contain exactly one local tono-windows package")
    versions["Windows Cargo.lock"] = locked[0]

    project = (root / "apps/macos/Tono.xcodeproj/project.pbxproj").read_text()
    configs = re.findall(
        r"isa = XCBuildConfiguration;\s*buildSettings = \{(.*?)\};\s*name = (\w+);",
        project, re.S,
    )
    build_numbers = {}
    for settings, name in configs:
        fields = dict(re.findall(r"(\w+)\s*=\s*([^;\n]+);", settings))
        fields = {key: value.strip().strip('"') for key, value in fields.items()}
        if fields.get("PRODUCT_BUNDLE_IDENTIFIER") != "com.raydocs.tono":
            continue
        key = f"macOS {name}"
        if key in versions:
            raise ValueError(f"duplicate product configuration: {name}")
        versions[key] = fields["MARKETING_VERSION"]
        build_numbers[name] = fields["CURRENT_PROJECT_VERSION"]
    if set(build_numbers) != {"Debug", "Release"}:
        raise ValueError("both macOS Tono Debug and Release configurations must be checked")
    if len(set(build_numbers.values())) != 1:
        raise ValueError(f"macOS build numbers disagree: {build_numbers}")
    return versions


def verify(root: Path, expected: str | None = None) -> dict[str, str]:
    versions = desktop_versions(root)
    if any(not isinstance(value, str) or not value for value in versions.values()):
        raise ValueError("every product version must be a nonempty string")
    if len(set(versions.values())) != 1:
        raise ValueError(f"desktop product versions disagree: {versions}")
    if expected is not None and next(iter(versions.values())) != expected:
        raise ValueError(f"expected product version {expected}, found {versions}")
    return versions


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--expected", help="exact candidate version, e.g. 0.0.72")
    args = parser.parse_args()
    try:
        versions = verify(args.root, args.expected)
    except (ValueError, KeyError, OSError) as error:
        print(f"desktop-version: FAIL: {error}")
        return 1
    print(json.dumps(versions, indent=2))
    print("desktop-version: PASS (source consistency only, not publication acceptance)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
