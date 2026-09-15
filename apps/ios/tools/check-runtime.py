#!/usr/bin/env python3
"""Build/test the iOS Go sources with the exact upstream module, never an SDK stub.

No downloads, patching of the caller's checkout, profile install or publication.
The caller supplies a clean source checkout and the pinned Go toolchain. First
populate its module cache with `go mod download`; builds disable module downloads.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise SystemExit(message)


def check(source, go, output, probe_libbox):
    pins = json.loads((ROOT / "Configuration/core-requirement.json").read_text())
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    require(head == pins["upstream_commit"], "upstream commit mismatch")
    require(not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"], cwd=source), "upstream must be clean")
    for name in ("go.mod", "go.sum"):
        require(sha(source / name) == pins[name.replace(".", "_") + "_sha256"], name + " mismatch")
    env = {k: os.environ[k] for k in ("HOME", "TMPDIR") if k in os.environ}
    env.update(PATH=str(go.parent) + os.pathsep + os.defpath, GOENV="off", GOWORK="off",
               GOTOOLCHAIN="local", CGO_ENABLED="0", GOPROXY="off", GOSUMDB="off",
               GOTELEMETRY="off", GOFLAGS="", GOOS="linux", GOARCH="amd64", GOAMD64="v2")
    version = subprocess.check_output([go, "version"], env=env, text=True).strip()
    require(version == "go version " + pins["go_version"] + " linux/amd64", "Go toolchain/host mismatch")
    require(not output.exists(), "output must not already exist")
    tags = ",".join(pins["tags"])
    with tempfile.TemporaryDirectory(prefix="tono-ios-runtime-") as directory:
        stage = Path(directory)
        archive = stage / "source.tar"
        with archive.open("wb") as stream:
            subprocess.run(["git", "archive", "HEAD"], cwd=source, stdout=stream, check=True)
        with tarfile.open(archive) as tar:
            tar.extractall(stage, filter="data")
        archive.unlink()
        overlay = stage / "experimental/tonoios"
        overlay.mkdir()
        sources = sorted((ROOT / "Runtime").glob("*.go"))
        require(bool(sources), "missing iOS Go sources")
        for path in sources:
            (overlay / path.name).write_bytes(path.read_bytes())
        args = [go, "test", "-mod=readonly", "-trimpath", "-tags", tags]
        subprocess.run(args + ["-count=1", "-v", "./experimental/tonoios"], cwd=stage, env=env, check=True, timeout=600)
        # Build the actual libbox graph as well as the compiler. This Linux
        # archive does NOT establish an Objective-C ABI or iOS slice.
        library = stage / "libbox-linux.a"
        subprocess.run([go, "build", "-mod=readonly", "-trimpath", "-tags", tags, "-o", library,
                        "./experimental/libbox"], cwd=stage, env=env, check=True, timeout=600)
        first = sha(library)
        subprocess.run([go, "build", "-mod=readonly", "-trimpath", "-tags", tags, "-o", library,
                        "./experimental/libbox"], cwd=stage, env=env, check=True, timeout=600)
        require(first == sha(library), "libbox repeat-build mismatch")
        require(sha(stage / "go.mod") == pins["go_mod_sha256"] and sha(stage / "go.sum") == pins["go_sum_sha256"], "module graph changed")
        receipt = dict(scope="linux-source-and-parser-only-not-apple-abi", upstream=head,
                       toolchain=version, cgo="0", tags=pins["tags"], libbox_linux_archive_sha256=first,
                       sources={p.name: sha(p) for p in sources}, apple_artifact=None,
                       libbox_link={"status": "not-run"},
                       checks=["iOS Go unit tests with actual core parser", "libbox Linux archive build", "repeat-build hash equality"])
        link_failed = False
        if probe_libbox:
            probe = stage / "cmd/tono-ios-link-probe"
            probe.mkdir()
            (probe / "main.go").write_text('package main\nimport "github.com/sagernet/sing-box/experimental/libbox"\nfunc main() { _ = libbox.CheckConfig("{}") }\n')
            result = subprocess.run([go, "build", "-mod=readonly", "-trimpath", "-tags", tags,
                                     "-o", stage / "link-probe", "./cmd/tono-ios-link-probe"],
                                    cwd=stage, env=env, text=True, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, timeout=600)
            link_failed = result.returncode != 0
            receipt["libbox_link"] = dict(status="failed" if link_failed else "passed",
                                          exit_code=result.returncode, diagnostic=result.stdout[-4096:])
        output.write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt, indent=2))
        if link_failed:
            raise SystemExit(2)  # Preserve successful source evidence, never call the link green.


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--go", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--probe-libbox", action="store_true", help="also link actual libbox; failed link writes receipt and exits 2")
    args = parser.parse_args()
    check(args.source.resolve(), args.go.resolve(), args.receipt.resolve(), args.probe_libbox)
