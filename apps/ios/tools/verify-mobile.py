#!/usr/bin/env python3
"""Check an independently reviewed receipt digest and every Apple artifact file.

This is a pre-Xcode integrity gate, not code signing or third-party attestation.
Do not take --receipt-sha256 from an untrusted download beside the framework.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify(directory, expected, require_apple):
    receipt = directory / "receipt.json"
    if digest(receipt) != expected:
        raise SystemExit("reviewed receipt digest mismatch")
    value = json.loads(receipt.read_text())
    if value["pins"] != json.loads((ROOT / "Configuration/core-requirement.json").read_text()):
        raise SystemExit("source pins changed")
    sources = {str(p.relative_to(ROOT)) for folder in ("Runtime", "Mobile") for p in (ROOT / folder).glob("*.go")}
    sources.update(["tools/build-mobile.py", "tools/worker-runtime-fixture.mjs", "Mobile/ABI/Tonomobile.objc.h"])
    if set(value["inputs"]) != sources:
        raise SystemExit("source inventory mismatch")
    for name, expected in value["inputs"].items():
        if digest(ROOT / name) != expected:
            raise SystemExit("source input mismatch: " + name)
    for name, expected in value["pins"]["mobile"]["patches"].items():
        if digest(ROOT / "patches" / name) != expected:
            raise SystemExit("patch mismatch")
    if digest(directory / "Tonomobile.objc.h") != value["abi_sha256"]:
        raise SystemExit("ABI mismatch")
    auxiliary = {p.name: digest(p) for p in directory.iterdir() if p.is_file() and p.name != "receipt.json"}
    if auxiliary != value["auxiliary"]:
        raise SystemExit("artifact metadata/configuration mismatch")
    if value["apple"] is None:
        if require_apple:
            raise SystemExit("Linux evidence is not an Apple artifact")
        if digest(directory / "host-link-probe") != value["host_link_sha256"]:
            raise SystemExit("host binary mismatch")
    else:
        root = directory / "Tonomobile.xcframework"
        actual = {str(p.relative_to(root)): digest(p) for p in root.rglob("*") if p.is_file()}
        if actual != value["apple"]["files"]:
            raise SystemExit("Apple framework inventory/hash mismatch")
    print("Verified exact source, ABI and artifact bytes; native acceptance is separate")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--receipt-sha256", required=True)
    parser.add_argument("--require-apple", action="store_true")
    args = parser.parse_args()
    verify(args.directory, args.receipt_sha256, args.require_apple)
