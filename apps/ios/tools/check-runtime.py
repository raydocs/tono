#!/usr/bin/env python3
"""Compatibility entry point for the full patched mobile source/link checks.

Unlike the old archive-only check, linking and ABI generation are mandatory.
Both clean upstream checkouts are now required. See build-mobile.py for Apple.
"""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "tun-source", "go", "receipt"):
        parser.add_argument("--" + name, type=lambda s: Path(s).resolve(), required=True)
    parser.add_argument("--probe-libbox", action="store_true", help="retained compatibility flag; linking is always checked")
    args = parser.parse_args()
    if args.receipt.exists():
        raise SystemExit("receipt must not exist")
    with tempfile.TemporaryDirectory(prefix="tono-mobile-check-") as tmp:
        out = Path(tmp) / "result"
        subprocess.run([sys.executable, Path(__file__).with_name("build-mobile.py"),
                        "--source", args.source, "--tun-source", args.tun_source,
                        "--go", args.go, "--out", out], check=True)
        shutil.copyfile(out / "receipt.json", args.receipt)
