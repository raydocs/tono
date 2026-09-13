#!/usr/bin/env python3
"""Build the pinned Tono Linux experiment; never install a product binary."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

BASELINE = "1d00b581dffdd98e84821c8789eb0c46b7a21bed"
UPSTREAM = "ac017cdd246ce8bd547653d927e7bf77d7ee73d5"
VERSION = "v1.19.30-tono-gvisor-adaptive.1"
GO = "go1.27.1"


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--go", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path,
                        help="New directory outside every repository/worktree")
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    root = Path(__file__).resolve().parents[3]
    output = args.output.resolve()
    # Reject product destinations, including worktrees other than this one.
    worktrees = subprocess.check_output(
        ["git", "worktree", "list", "--porcelain"], cwd=root, text=True)
    for line in worktrees.splitlines():
        if line.startswith("worktree ") and output.is_relative_to(Path(line[9:]).resolve()):
            parser.error("output must be outside all Tono worktrees")
    output.mkdir(parents=True, exist_ok=False)
    log = output / "build.log"
    env = dict(os.environ, GOTOOLCHAIN="local", CGO_ENABLED="0", GOOS="linux",
               GOARCH="amd64", GOAMD64="v2", GOMAXPROCS="4", GOFLAGS="")
    go = str(args.go.resolve())
    manifest = {"status": "BASELINE_UNAVAILABLE", "repository_baseline": BASELINE,
                "upstream_commit": UPSTREAM, "version": VERSION, "go": GO,
                "GOOS": "linux", "GOARCH": "amd64", "GOAMD64": "v2",
                "CGO_ENABLED": "0", "build_tags": ["with_gvisor"],
                "commands": []}

    def run(command, cwd=output, timeout=600):
        manifest["commands"].append(command)
        with log.open("a") as stream:
            process = subprocess.Popen(command, cwd=cwd, env=env, stdout=stream,
                                       stderr=subprocess.STDOUT, start_new_session=True)
            try:
                process.wait(timeout=timeout)
            except BaseException:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
                raise
        if process.returncode:
            raise RuntimeError(f"command exit {process.returncode}: {command[0]}")

    try:
        if subprocess.check_output([go, "env", "GOVERSION"], env=env, text=True, timeout=10).strip() != GO:
            raise RuntimeError("exact Go toolchain is unavailable")
        patch = root / "tooling/scripts/mihomo-adaptive/gvisor-adaptive-buffer.patch"
        for identity in [root / "apps/macos/Tono/Resources/core-identity.json",
                         root / "apps/windows/app/src-tauri/core-identity.json"]:
            data = json.loads(identity.read_text())
            assert (data["tonoCoreVersion"], data["upstreamCommit"], data["goVersion"],
                    data["singTun"], data["buildTags"]) == (
                        VERSION, UPSTREAM, GO, "v0.4.22", ["with_gvisor"])
            assert identity.read_bytes() == subprocess.check_output(
                ["git", "show", f"{BASELINE}:{identity.relative_to(root)}"], cwd=root, timeout=10)
        assert patch.read_bytes() == subprocess.check_output(
            ["git", "show", f"{BASELINE}:{patch.relative_to(root)}"], cwd=root, timeout=10)
        manifest["patch_sha256"] = digest(patch)
        source = output / "mihomo"
        run(["git", "init", "-q", str(source)])
        run(["git", "fetch", "--quiet", "--depth=1",
             "https://github.com/MetaCubeX/mihomo.git", UPSTREAM], source)
        run(["git", "checkout", "--quiet", "--detach", "FETCH_HEAD"], source)
        assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source,
                                       text=True).strip() == UPSTREAM
        manifest["upstream_go_mod_sha256"] = digest(source / "go.mod")
        manifest["upstream_go_sum_sha256"] = digest(source / "go.sum")
        run([go, "mod", "download", "github.com/metacubex/sing-tun@v0.4.22"], source)
        module = json.loads(subprocess.check_output(
            [go, "mod", "download", "-json", "github.com/metacubex/sing-tun@v0.4.22"],
            cwd=source, env=env, text=True, timeout=120))
        manifest["sing_tun_sum"] = module["Sum"]
        import shutil
        tun = output / "sing-tun"
        shutil.copytree(module["Dir"], tun)
        tun.chmod(tun.stat().st_mode | 0o200)
        for path in tun.rglob("*"):
            path.chmod(path.stat().st_mode | 0o200)
        run(["patch", "--batch", "--fuzz=0", "-p1", "-i", str(patch)], tun)
        run([go, "test", "-mod=readonly", "-tags", "with_gvisor", "-run",
             "^TestTonoAdaptiveGVisorTCPBuffers$", "-count=1", "."], tun)
        run([go, "mod", "edit", f"-replace=github.com/metacubex/sing-tun={tun}"], source)
        # Deterministic experiment timestamp; it is not a product build timestamp.
        flags = (f"-X github.com/metacubex/mihomo/constant.Version={VERSION} "
                 "-X github.com/metacubex/mihomo/constant.BuildTime=2026-09-13T00:00:00Z "
                 "-w -s -buildid=")
        binary = output / "mihomo-tono-linux-amd64"
        run([go, "build", "-mod=readonly", "-tags", "with_gvisor", "-trimpath",
             "-ldflags", flags, "-o", str(binary), "."], source)
        # Build must not resolve a different locked dependency graph.
        assert digest(source / "go.sum") == manifest["upstream_go_sum_sha256"]
        info = subprocess.check_output([go, "version", "-m", str(binary)], text=True)
        (output / "build-info.txt").write_text(info)
        version = subprocess.check_output([str(binary), "-v"], text=True)
        assert VERSION in version and "with_gvisor" in version
        manifest.update(status="BUILT", binary_sha256=digest(binary),
                        version_output=version, ldflags=flags)
    except (Exception, KeyboardInterrupt, SystemExit) as error:
        manifest["error"] = str(error)
    finally:
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))
    return 0 if manifest["status"] == "BUILT" else 1


if __name__ == "__main__":
    sys.exit(main())
