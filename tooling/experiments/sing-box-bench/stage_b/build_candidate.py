#!/usr/bin/env python3
"""Fixed Stage B source build; never installs or updates a Tono product core."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bench import command

COMMIT = "93fff5954390367dd456cad3cbd79be54f8b941f"
TUN = "v0.9.4-0.20260912075549-869f0a4d76af"
TAGS = "with_gvisor,with_quic,with_utls,with_clash_api"
VERSION = "1.14.0-alpha.0-experiment.93fff595"


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--go", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True,
                        help="Clean checkout of the exact commit, outside Tono worktrees")
    parser.add_argument("--output", type=Path, required=True, help="New external directory")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[4]
    source, output = args.source.resolve(), args.output.resolve()
    for line in subprocess.check_output(["git", "worktree", "list", "--porcelain"],
                                        cwd=root, text=True).splitlines():
        if line.startswith("worktree "):
            tree = Path(line[9:]).resolve()
            if source.is_relative_to(tree) or output.is_relative_to(tree):
                parser.error("source/output must be outside every Tono worktree")
    output.mkdir(parents=True, exist_ok=False)
    result = {"status": "CANDIDATE_UNAVAILABLE", "commit": COMMIT,
              "sing_tun": TUN, "tags": TAGS, "version_label": VERSION,
              "note": "Synthetic version label; identity is the commit and module graph",
              "commands": []}
    try:
        assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source,
                                       text=True).strip() == COMMIT
        assert not subprocess.check_output(["git", "status", "--porcelain"], cwd=source)
        assert f"github.com/sagernet/sing-tun {TUN}" in (source / "go.mod").read_text()
        assert subprocess.check_output([str(args.go), "env", "GOVERSION"],
                                       text=True).strip() == "go1.27.1"
        result["go_mod_sha256"], result["go_sum_sha256"] = sha(source / "go.mod"), sha(source / "go.sum")
        env = {"GOTOOLCHAIN": "local", "CGO_ENABLED": "0", "GOOS": "linux",
               "GOARCH": "amd64", "GOAMD64": "v2", "GOMAXPROCS": "4", "GOFLAGS": ""}
        result["build_environment"] = env
        flags = f"-X github.com/sagernet/sing-box/constant.Version={VERSION} -w -s -buildid="
        binary = output / "sing-box-linux-amd64"
        argv = ["env", *[f"{key}={value}" for key, value in env.items()],
                str(args.go.resolve()), "-C", str(source), "build", "-mod=readonly",
                "-trimpath", "-tags", TAGS, "-ldflags", flags,
                "-o", str(binary), "./cmd/sing-box"]
        execution = command(argv, timeout=600)
        (output / "build.log").write_text(execution["stdout"] + execution["stderr"])
        result["commands"].append({k: v for k, v in execution.items() if k not in ("stdout", "stderr")})
        assert execution["status"] == "PASS", "build failed; see build.log"
        assert sha(source / "go.mod") == result["go_mod_sha256"]
        assert sha(source / "go.sum") == result["go_sum_sha256"]
        assert not subprocess.check_output(["git", "status", "--porcelain"], cwd=source)
        info = subprocess.check_output([str(args.go), "version", "-m", str(binary)], text=True)
        assert COMMIT in info and TUN in info
        (output / "build-info.txt").write_text(info)
        result.update(status="BUILT", binary_sha256=sha(binary), ldflags=flags,
                      version_output=subprocess.check_output([str(binary), "version"], text=True))
    except (Exception, KeyboardInterrupt) as error:
        result["error"] = repr(error)
    finally:
        (output / "manifest.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "BUILT" else 1


if __name__ == "__main__":
    sys.exit(main())
