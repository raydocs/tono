"""Frozen M0 build provenance and synthetic parser checks; not product admission."""

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import platform
import shlex
import signal
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
M0 = ROOT / "docs/reports/sing-box-evaluation/migration-m0"
FROZEN = "7f64978c5d9d5b8551e0b81f7247cb5a630ebf56"
CANDIDATE_SHA = "9e50077ea88adcaf17c8b6c8344868f651ce4af9b576135669a8de02c2f101de"
REFERENCE_SHA = "f9977c06ccddf1001a77f0fe6ec13c5ffce4c053f8b721de908501fdf04ddbc0"
LIMIT = 8 * 1024 * 1024


class Refusal(Exception):
    pass


def require(condition, code):
    if not condition:
        raise Refusal(code)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def file_sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "TONO_SINGBOX_INVALID_JSON")
        result[key] = value
    return result


def read_json(path, expected_sha=None):
    with open(path, "rb") as stream:
        raw = stream.read(LIMIT + 1)
    require(len(raw) <= LIMIT and not raw.startswith(b"\xef\xbb\xbf"),
            "TONO_SINGBOX_INVALID_JSON")
    if expected_sha is not None:
        require(sha(raw) == expected_sha, "TONO_SINGBOX_HASH_MISMATCH")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                          parse_constant=lambda _: require(False, "TONO_SINGBOX_INVALID_JSON"))
    except (ValueError, UnicodeError):
        raise Refusal("TONO_SINGBOX_INVALID_JSON") from None


def encoded(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode()


def same_json(left, right):
    # Python equality alone conflates JSON booleans and integers.
    return json.dumps(left, sort_keys=True) == json.dumps(right, sort_keys=True)


def clean_env(go, target=None):
    # Do not inherit GOFLAGS, GOTOOLCHAIN, GOWORK, compiler flags or credentials.
    env = {key: os.environ[key] for key in ("HOME", "TMPDIR", "SYSTEMROOT") if key in os.environ}
    env.update(PATH=str(go.parent) + os.pathsep + os.defpath, GOENV="off", GOWORK="off",
               GOTOOLCHAIN="local", CGO_ENABLED="0", GOPROXY="off", GOSUMDB="off",
               GOFLAGS="", GOTELEMETRY="off", LC_ALL="C")
    if target:
        env.update(GOOS=target["goos"], GOARCH=target["goarch"])
        if "goamd64" in target:
            env["GOAMD64"] = target["goamd64"]
    return env


def command(argv, *, cwd=None, env=None, seconds=30, expected_exit=0):
    # Never forward tool output: parser/compiler diagnostics can include secrets.
    # A file bounds RAM use; temporary diagnostics are deleted even on refusal.
    with tempfile.TemporaryFile() as output:
        with subprocess.Popen([str(x) for x in argv], cwd=cwd, env=env,
                              stdin=subprocess.DEVNULL, stdout=output,
                              stderr=output, start_new_session=True) as proc:
            try:
                proc.wait(timeout=seconds)
            except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
                raise Refusal("TONO_SINGBOX_TIMEOUT" if isinstance(error, subprocess.TimeoutExpired)
                              else "TONO_SINGBOX_CANCELLED") from None
            require(proc.returncode == expected_exit, "TONO_SINGBOX_COMMAND_REJECTED")
        output.seek(0)
        data = output.read(LIMIT + 1)
        require(len(data) <= LIMIT, "TONO_SINGBOX_OUTPUT_LIMIT")
        return data.decode("utf-8", errors="strict").strip()


def pins():
    return read_json(M0 / "candidate.json", CANDIDATE_SHA)


def target_for(candidate, name):
    targets = {target_name(t): t for t in candidate["build"]["targets"]}
    require(name in targets, "TONO_SINGBOX_UNSUPPORTED_TARGET")
    return targets[name]


def target_name(target):
    return "-".join(target[k] for k in ("goos", "goarch", "goamd64") if k in target)


def go_identity(go, candidate):
    version = command([go, "version"], env=clean_env(go)).split()
    require(len(version) == 4 and version[:3] == ["go", "version", candidate["build"]["go_version"]],
            "TONO_SINGBOX_TOOLCHAIN_MISMATCH")


def build_info(go, binary, candidate, target):
    lines = command([go, "version", "-m", binary], env=clean_env(go)).splitlines()
    require(lines and lines[0].endswith(": " + candidate["build"]["go_version"]),
            "TONO_SINGBOX_BUILD_IDENTITY_MISMATCH")
    settings, modules = {}, []
    for line in lines[1:]:
        fields = shlex.split(line.strip())
        require(bool(fields), "TONO_SINGBOX_BUILD_IDENTITY_MISMATCH")
        if fields[0] == "build":
            require(len(fields) == 2 and "=" in fields[1], "TONO_SINGBOX_BUILD_IDENTITY_MISMATCH")
            key, value = fields[1].split("=", 1)
            require(key not in settings, "TONO_SINGBOX_BUILD_IDENTITY_MISMATCH")
            settings[key] = value
        else:
            require(fields[0] in ("path", "mod", "dep"), "TONO_SINGBOX_BUILD_IDENTITY_MISMATCH")
            modules.append(fields)
    expected = {"-buildmode": "exe", "-compiler": "gc", "-trimpath": "true",
                "CGO_ENABLED": "0", "GOOS": target["goos"], "GOARCH": target["goarch"],
                "vcs": "git", "vcs.revision": candidate["source"]["commit"], "vcs.modified": "false"}
    if "goamd64" in target:
        expected["GOAMD64"] = target["goamd64"]
    for key, value in expected.items():
        require(settings.get(key) == value, "TONO_SINGBOX_BUILD_IDENTITY_MISMATCH")
    require(sorted(settings.get("-tags", "").split(",")) == sorted(candidate["build"]["tags"]),
            "TONO_SINGBOX_BUILD_IDENTITY_MISMATCH")
    # Go may omit ldflags with -trimpath. Exact invocation is bound by manifest.
    if "-ldflags" in settings:
        require(settings["-ldflags"] == candidate["build"]["ldflags"], "TONO_SINGBOX_BUILD_IDENTITY_MISMATCH")
    require(["path", "github.com/sagernet/sing-box/cmd/sing-box"] in modules,
            "TONO_SINGBOX_BUILD_IDENTITY_MISMATCH")
    require(any(m[:3] == ["dep", "github.com/sagernet/sing-tun", candidate["source"]["sing_tun"]]
                for m in modules), "TONO_SINGBOX_BUILD_IDENTITY_MISMATCH")
    return {"settings": settings, "modules": modules}


def source_identity(source, candidate):
    env = {"PATH": os.defpath, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
           "GIT_NO_REPLACE_OBJECTS": "1"}
    require(command(["git", "rev-parse", "HEAD"], cwd=source, env=env) == candidate["source"]["commit"],
            "TONO_SINGBOX_SOURCE_MISMATCH")
    require(not command(["git", "status", "--porcelain", "--untracked-files=all", "--ignored"], cwd=source, env=env),
            "TONO_SINGBOX_SOURCE_DIRTY")
    tracked = command(["git", "ls-files", "-v"], cwd=source, env=env).splitlines()
    require(tracked and all(line.startswith("H ") for line in tracked), "TONO_SINGBOX_SOURCE_DIRTY")
    for filename, key in (("go.mod", "go_mod_sha256"), ("go.sum", "go_sum_sha256")):
        require(file_sha(source / filename) == candidate["source"][key], "TONO_SINGBOX_MODULE_MISMATCH")


def external_directory(path, source=None):
    require(path.is_absolute(), "TONO_SINGBOX_INVALID_OUTPUT")
    resolved = path.resolve()
    for forbidden in (ROOT, source):
        if forbidden:
            require(not resolved.is_relative_to(forbidden.resolve()), "TONO_SINGBOX_INVALID_OUTPUT")
    require(not path.exists() and not path.is_symlink(), "TONO_SINGBOX_INVALID_OUTPUT")
    return resolved


def build(args):
    candidate = pins()
    target = target_for(candidate, args.target)
    source, go = args.source.resolve(), args.go.resolve()
    output = external_directory(args.output, source)
    go_identity(go, candidate)
    source_identity(source, candidate)
    env = clean_env(go, target)
    command([go, "mod", "verify"], cwd=source, env=env, seconds=120)
    output.mkdir(mode=0o700)
    binary = output / ("sing-box.exe" if target["goos"] == "windows" else "sing-box")
    argv = [str(go), "build", *candidate["build"]["args"], "-buildvcs=true",
            "-tags", ",".join(candidate["build"]["tags"]),
            "-ldflags", candidate["build"]["ldflags"], "-o", str(binary), candidate["build"]["entrypoint"]]
    command(argv, cwd=source, env=env, seconds=1800)
    source_identity(source, candidate)
    identity = build_info(go, binary, candidate, target)
    manifest = {"schema_version": 1, "scope": "M1_OFFLINE_NOT_INSTALLABLE",
                "contract_commit": FROZEN, "candidate_sha256": CANDIDATE_SHA,
                "profile": candidate["profile"], "source": candidate["source"],
                "build": candidate["build"], "target": target,
                "binary": binary.name, "binary_sha256": file_sha(binary),
                "build_info": identity}
    raw = encoded(manifest)
    (output / "manifest.json").write_bytes(raw)
    return {"status": "built-not-qualified", "target": args.target,
            "binary_sha256": manifest["binary_sha256"], "manifest_sha256": sha(raw)}


def verify(args):
    candidate = pins()
    target = target_for(candidate, args.target)
    manifest = read_json(args.manifest, args.manifest_sha256)
    binary = args.binary.resolve()
    expected = {"schema_version", "scope", "contract_commit", "candidate_sha256", "profile",
                "source", "build", "target", "binary", "binary_sha256", "build_info"}
    require(isinstance(manifest, dict) and set(manifest) == expected,
            "TONO_SINGBOX_INVALID_MANIFEST")
    for key, value in {"schema_version": 1, "scope": "M1_OFFLINE_NOT_INSTALLABLE",
                       "contract_commit": FROZEN, "candidate_sha256": CANDIDATE_SHA,
                       "profile": candidate["profile"], "source": candidate["source"],
                       "build": candidate["build"], "target": target,
                       "binary": "sing-box.exe" if target["goos"] == "windows" else "sing-box"}.items():
        require(same_json(manifest[key], value), "TONO_SINGBOX_BUILD_IDENTITY_MISMATCH")
    require(file_sha(binary) == manifest["binary_sha256"], "TONO_SINGBOX_HASH_MISMATCH")
    go = args.go.resolve()
    go_identity(go, candidate)
    require(build_info(go, binary, candidate, target) == manifest["build_info"],
            "TONO_SINGBOX_BUILD_IDENTITY_MISMATCH")
    return {"status": "identity-verified-not-qualified", "target": args.target,
            "binary_sha256": manifest["binary_sha256"]}


def synthetic_fixture(path):
    reference = read_json(M0 / "reference.json", REFERENCE_SHA)
    fixture = read_json(path)
    require(isinstance(fixture, dict) and set(fixture) == set(reference), "TONO_SINGBOX_INVALID_FIXTURE")
    data = fixture["input"]
    require(isinstance(data, dict) and set(data) == set(reference["input"]), "TONO_SINGBOX_INVALID_FIXTURE")
    routing = data["catalog_routing"]
    require(isinstance(routing, dict), "TONO_SINGBOX_UNSUPPORTED_HOME_ROUTE")
    require(not any(k in routing for k in ("homeProxy", "homeSocks5")), "TONO_SINGBOX_UNSUPPORTED_HOME_ROUTE")
    require(routing == {}, "TONO_SINGBOX_UNSUPPORTED_POLICY")
    require(data["policy_document"] == reference["input"]["policy_document"]
            and data["derived_requirements"] == [] and data["direct_plan"] is None,
            "TONO_SINGBOX_UNSUPPORTED_POLICY")
    require(isinstance(data["nodes"], list) and 1 <= len(data["nodes"]) <= 200,
            "TONO_SINGBOX_INVALID_NODE")
    for node in data["nodes"]:
        require(isinstance(node, dict) and node.get("type") == "vless" and node.get("network") == "tcp",
                "TONO_SINGBOX_UNSUPPORTED_TRANSPORT")
        require(node.get("client-fingerprint") == "chrome", "TONO_SINGBOX_UNSUPPORTED_FINGERPRINT")
    # This is deliberately not another platform emitter/admission API. Only the
    # full frozen synthetic fixture is accepted, never claimed verified product input.
    require(same_json(fixture, reference), "TONO_SINGBOX_INVALID_FIXTURE")
    return fixture


def check(args):
    fixture = synthetic_fixture(args.fixture)
    result = verify(args)
    require(args.target == "linux-amd64-v2" and platform.system() == "Linux"
            and platform.machine() == "x86_64", "TONO_SINGBOX_UNSUPPORTED_CHECK_HOST")
    output = external_directory(args.output)
    output.mkdir(mode=0o700)
    receipts = []
    # Private temporary runtime bytes never become durable output or a draft API.
    with tempfile.TemporaryDirectory(prefix=".check-", dir=output) as staging:
        binary = Path(staging) / "sing-box"
        binary.write_bytes(args.binary.read_bytes())
        require(file_sha(binary) == result["binary_sha256"], "TONO_SINGBOX_HASH_MISMATCH")
        binary.chmod(0o500)
        for name, interface in (("windows-amd64-v2", "Tono"), ("macos-arm64", "utun199")):
            runtime = copy.deepcopy(fixture["windows_runtime"])
            runtime["inbounds"][0]["interface_name"] = interface
            raw = encoded(runtime)
            config = Path(staging) / "runtime.json"
            config.write_bytes(raw)
            config.chmod(0o400)
            command([binary, "check", "-c", config], cwd=staging,
                    env={"PATH": os.defpath, "HOME": staging}, seconds=15)
            receipts.append({"platform_shape": name, "runtime_sha256": sha(raw), "check_exit": 0})
            config.unlink()
        runtime["outbounds"][0]["tls"]["reality"]["public_key"] = "invalid"
        config.write_bytes(encoded(runtime))
        config.chmod(0o400)
        diagnostic = command([binary, "check", "-c", config], cwd=staging,
                             env={"PATH": os.defpath, "HOME": staging}, seconds=15, expected_exit=1)
        require("invalid public_key" in diagnostic, "TONO_SINGBOX_NEGATIVE_CONTROL_FAILED")
    report = {"status": "parser-only-not-authenticated", "profile": pins()["profile"],
              "binary_sha256": result["binary_sha256"], "node_count": 2,
              "selected_index": 1, "checks": receipts, "invalid_key_check_exit": 1}
    (output / "check.json").write_bytes(encoded(report))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    build_parser = commands.add_parser("build")
    build_parser.add_argument("--source", type=Path, required=True)
    build_parser.add_argument("--output", type=Path, required=True)
    for name, sub in (("build", build_parser), ("verify", commands.add_parser("verify")),
                      ("check", commands.add_parser("check"))):
        sub.add_argument("--go", type=Path, required=True)
        sub.add_argument("--target", required=True)
        if name != "build":
            sub.add_argument("--binary", type=Path, required=True)
            sub.add_argument("--manifest", type=Path, required=True)
            sub.add_argument("--manifest-sha256", required=True)
        if name == "check":
            sub.add_argument("--fixture", type=Path, required=True)
            sub.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        print(encoded({"ok": True, **globals()[args.action](args)}).decode(), end="")
    except Refusal as error:
        print(json.dumps({"ok": False, "error": str(error)}))
        return 1
    except (OSError, ValueError, TypeError, KeyError):
        print(json.dumps({"ok": False, "error": "TONO_SINGBOX_INVALID_INPUT"}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
