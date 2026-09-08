#!/usr/bin/env python3
"""Local-only stability checks with full logs and source fingerprints, never a release gate.

No install, deployment, sudo, network reconfiguration, dependency update or Git
mutation is performed. Python 3.11+, approved toolchain pins and installed caches
are required. Native Windows and signed/privileged qualification remain separate.
"""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]


def source_snapshot():
    def git(*args):
        return subprocess.check_output(["git", *args], cwd=ROOT)

    paths = set(git("diff", "--name-only", "-z", "HEAD").split(b"\0"))
    paths.update(git("ls-files", "--others", "--exclude-standard", "-z").split(b"\0"))
    files = {}
    for raw in sorted(paths - {b""}):
        path = ROOT / os.fsdecode(raw)
        if path.is_symlink():
            value = {"symlink": os.readlink(path)}
        elif path.is_file():
            value = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
        else:
            value = {"deleted": True}
        files[os.fsdecode(raw)] = value
    return {"head": git("rev-parse", "HEAD").decode().strip(), "changed_files": files}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expected-version", default="0.0.72")
    parser.add_argument("--only", action="append", help="run named check(s), not full local acceptance")
    args = parser.parse_args()
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        parser.error("run as an ordinary user; privileged qualification must be isolated and explicit")

    rust = ["cargo", "+1.98.1"]
    checks = [
        ("version-tests", ROOT, [sys.executable, "tooling/scripts/tests/test_desktop_version.py"]),
        ("desktop-version", ROOT, [sys.executable, "tooling/scripts/verify-desktop-version.py", "--expected", args.expected_version]),
        ("portable-core", ROOT, rust + ["test", "--offline", "--locked", "--manifest-path", "apps/windows/Cargo.toml", "-p", "tono-core"]),
        ("app-rust", ROOT, rust + ["test", "--offline", "--locked", "--manifest-path", "apps/windows/app/src-tauri/Cargo.toml", "--features", "clippy", "--lib"]),
        ("service-models", ROOT, rust + ["test", "--offline", "--locked", "--manifest-path", "apps/windows/service/Cargo.toml", "--features", "standalone,client,test", "--lib"]),
        ("frontend-types", ROOT / "apps/windows/app", ["pnpm", "typecheck"]),
        ("frontend-tests", ROOT / "apps/windows/app", ["pnpm", "test"]),
        ("packaging-tests", ROOT / "apps/windows/app", ["pnpm", "test:dev-control"]),
        ("worker-types", ROOT / "services/control-plane", ["npm", "run", "typecheck"]),
        ("worker-tests", ROOT / "services/control-plane", ["npm", "test"]),
        ("policy-contract", ROOT, ["bash", "tooling/scripts/test-policy-signing-contract.sh"]),
    ]
    if platform.system() == "Darwin":
        checks += [
            ("macos-suite", ROOT, ["zsh", "tooling/scripts/test-macos-all.sh"]),
            ("macos-release", ROOT, ["xcodebuild", "-project", "apps/macos/Tono.xcodeproj", "-scheme", "Tono", "-configuration", "Release", "-destination", "platform=macOS,arch=arm64", "-jobs", "4", "CODE_SIGNING_ALLOWED=NO", "build"]),
            ("helper-unprivileged", ROOT, ["apps/macos/Tono/Resources/tono-core-helper", "--self-test"]),
            ("service-windows-compile", ROOT, rust + ["check", "--offline", "--locked", "--manifest-path", "apps/windows/service/Cargo.toml", "--target", "x86_64-pc-windows-msvc", "--features", "standalone,client", "--lib", "--bins"]),
        ]
    if args.only:
        unknown = set(args.only) - {name for name, _, _ in checks}
        if unknown:
            parser.error(f"unknown or unavailable checks: {sorted(unknown)}")
        checks = [check for check in checks if check[0] in args.only]

    out = ROOT / "artifacts/stability-0072" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out.mkdir(parents=True, exist_ok=False)
    before = source_snapshot()
    (out / "source-before.json").write_text(json.dumps(before, indent=2))
    env = os.environ.copy()
    # The umbrella script's opt-in network/install fixtures must never leak in
    # from the caller's environment into this deliberately unprivileged run.
    for key in ("TONO_TEST_RUNTIME_YAML", "TONO_TEST_SIGNED_APP"):
        env.pop(key, None)
    report = {
        "expected_version": args.expected_version,
        "platform": platform.platform(),
        "source_head": before["head"],
        "selected_checks_only": bool(args.only),
        "release_accepted": False,
        "qualification_still_required": [
            "Windows native App build/tests and signed installer/upgrade",
            "Windows administrator real WFP/DNS and service lifecycle",
            "isolated macOS PF/helper lifecycle and signed install/upgrade",
            "real protected data plane and leak/recovery qualification",
        ],
        "checks": [],
    }
    for name, cwd, command in checks:
        start = time.monotonic()
        log = out / f"{name}.log"
        print(f"RUN {name}", flush=True)
        with log.open("w") as output:
            try:
                result = subprocess.run(command, cwd=cwd, env=env, stdout=output, stderr=subprocess.STDOUT)
                code = result.returncode
            except OSError as error:
                output.write(str(error) + "\n")
                code = 127
        row = {
            "name": name, "command": command, "cwd": str(cwd.relative_to(ROOT)),
            "exit_code": code, "seconds": round(time.monotonic() - start, 2), "log": log.name,
        }
        report["checks"].append(row)
        (out / "report.json").write_text(json.dumps(report, indent=2))
        print(f"{'PASS' if code == 0 else 'FAIL'} {name}: exit={code}, log={log}", flush=True)

    after = source_snapshot()
    (out / "source-after.json").write_text(json.dumps(after, indent=2))
    report["source_unchanged_during_checks"] = before == after
    report["local_checks_passed"] = before == after and all(c["exit_code"] == 0 for c in report["checks"])
    (out / "report.json").write_text(json.dumps(report, indent=2))
    print(f"Report: {out / 'report.json'}")
    print("LOCAL CHECKS ONLY. Privileged/native skips are not release acceptance.")
    return 0 if report["local_checks_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
