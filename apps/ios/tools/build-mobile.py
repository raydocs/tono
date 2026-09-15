#!/usr/bin/env python3
"""Offline, pinned Tono mobile build. No signing, install, release or downloads.

Populate source/module/toolchain caches first. Linux executes the real linked
packet flow and QUIC negatives and emits Objective-C ABI; --apple additionally
requires explicitly pinned Xcode/SDK builds and produces two arm64 slices.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "github.com/sagernet/sing-box/experimental/tonomobile"


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(ok, reason):
    if not ok:
        raise SystemExit(reason)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def archive(source, target, commit):
    require(subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip() == commit, "source ref mismatch")
    require(not subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=all"], cwd=source), "source must be clean")
    target.mkdir()
    with tempfile.TemporaryFile() as data:
        subprocess.run(["git", "archive", "HEAD"], cwd=source, stdout=data, check=True)
        data.seek(0)
        with tarfile.open(fileobj=data) as tar:
            tar.extractall(target, filter="data")


def build(args):
    pins = json.loads((ROOT / "Configuration/core-requirement.json").read_text())
    mobile = pins["mobile"]
    require(not args.out.exists(), "output must not exist")
    require(not args.apple or platform.system() == "Darwin", "Apple SDK build requires macOS; no cross-SDK substitution")
    env = {k: os.environ[k] for k in ("HOME", "TMPDIR", "DEVELOPER_DIR") if k in os.environ}
    env.update(PATH=str(args.go.parent) + os.pathsep + os.defpath, GOENV="off", GOWORK="off", GOTOOLCHAIN="local",
               GOPROXY="off", GOSUMDB="off", CGO_ENABLED="0", GOTELEMETRY="off", GOFLAGS="")
    def run(cmd, cwd, **kwargs):
        return subprocess.run([str(x) for x in cmd], cwd=cwd, env=env, check=True, timeout=900, **kwargs)
    def output(cmd, cwd):
        return run(cmd, cwd, stdout=subprocess.PIPE, text=True).stdout.strip()
    version = output([args.go, "version"], ROOT)
    require(version.split()[2] == pins["go_version"], "Go version mismatch")
    sources = sorted([*(ROOT / "Runtime").glob("*.go"), *(ROOT / "Mobile").glob("*.go")])
    inputs = {str(p.relative_to(ROOT)): sha(p) for p in sources}
    inputs["tools/build-mobile.py"] = sha(Path(__file__))
    inputs["tools/worker-runtime-fixture.mjs"] = sha(ROOT / "tools/worker-runtime-fixture.mjs")
    inputs["Mobile/ABI/Tonomobile.objc.h"] = sha(ROOT / "Mobile/ABI/Tonomobile.objc.h")
    for name, expected in mobile["patches"].items():
        require(sha(ROOT / "patches" / name) == expected, "patch digest mismatch: " + name)
    source_id = hashlib.sha256(canonical(dict(pins=pins, sources=inputs))).hexdigest()
    receipt = dict(source_identity=source_id, inputs=inputs, pins=pins, host=version, apple=None)
    if args.apple:
        sdk = {name: output(["xcrun", "--sdk", name, "--show-sdk-build-version"], ROOT) for name in ("iphoneos", "iphonesimulator")}
        xcode = output(["xcodebuild", "-version"], ROOT)
        require(args.sdk_build == sdk["iphoneos"] and args.simulator_sdk_build == sdk["iphonesimulator"] and
                args.xcode_build == xcode.split()[-1], "explicit Xcode/SDK build pins required/mismatched")
        receipt["apple"] = dict(sdk=sdk, xcode=xcode, cgo="1", targets=mobile["targets"])
    identity = hashlib.sha256(canonical(dict(source=source_id, apple=receipt["apple"]))).hexdigest()
    receipt["identity"] = identity
    with tempfile.TemporaryDirectory(prefix="tono-mobile-") as tmp:
        stage = Path(tmp) / "box"
        tun = Path(tmp) / "tun"
        archive(args.source, stage, pins["upstream_commit"])
        archive(args.tun_source, tun, mobile["sing_tun_commit"])
        for name in ("go.mod", "go.sum"):
            require(sha(stage / name) == pins[name.replace(".", "_") + "_sha256"], "upstream module graph mismatch")
        run(["git", "apply", "--check", "--whitespace=error-all", ROOT / "patches/sing-box-mobile.patch"], stage)
        run(["git", "apply", ROOT / "patches/sing-box-mobile.patch"], stage)
        run(["git", "apply", "--check", "--whitespace=error-all", ROOT / "patches/sing-tun-packet-flow.patch"], tun)
        run(["git", "apply", ROOT / "patches/sing-tun-packet-flow.patch"], tun)
        for folder, name in (("Runtime", "tonoios"), ("Mobile", "tonomobile")):
            target = stage / "experimental" / name
            target.mkdir()
            for path in (ROOT / folder).glob("*.go"):
                shutil.copyfile(path, target / path.name)
        node = shutil.which("node")
        require(node is not None, "Node24.18.0 and lockfile-installed Worker dependencies required")
        require(output([node, "--version"], ROOT) == "v24.18.0", "fixture Node version mismatch")
        fixture = stage / "experimental/tonoios/worker-envelope.json"
        run([node, ROOT / "tools/worker-runtime-fixture.mjs", fixture], ROOT)
        receipt["worker_fixture_sha256"] = sha(fixture)
        run([args.go, "mod", "edit", "-replace", "github.com/sagernet/sing-tun=../tun"], stage)
        patched_mod = sha(stage / "go.mod")
        receipt["patched_go_mod_sha256"] = patched_mod
        tags = ",".join(pins["tags"] + mobile["extra_tags"])
        flags = ["-mod=readonly", "-trimpath", "-tags", tags]
        run([args.go, "test", *flags, "-count=1", "-v", "./experimental/tonoios", "./experimental/tonomobile",
             "./experimental/libbox", "./common/tls", "-run", "TestEmitted|TestHY2|TestSigned|TestRaw|TestAmbiguous|TestTono|TestExact|TestMobile|TestWorker|TestNode|TestProxied"], stage)
        tools = Path(tmp) / "tools"
        tools.mkdir()
        env["PATH"] = str(tools) + os.pathsep + env["PATH"]
        for name in ("gobind", "gomobile"):
            # Resolve the generator from the locked module graph, never @latest.
            module = json.loads(output([args.go, "list", "-m", "-json", "github.com/sagernet/gomobile"], stage))
            require(module["Version"] == mobile["gomobile"] and "Replace" not in module, "generator mismatch")
            run([args.go, "build", "-mod=readonly", "-trimpath", "-o", tools / name,
                 "github.com/sagernet/gomobile/cmd/" + name], stage)
        abi = Path(tmp) / "abi"
        run([tools / "gobind", "-lang=objc", "-tags=" + tags, "-outdir=" + str(abi), "./experimental/tonomobile"], stage)
        header = abi / "src/gobind/Tonomobile.objc.h"
        require(header.read_bytes() == (ROOT / "Mobile/ABI/Tonomobile.objc.h").read_bytes(), "Objective-C ABI drift")
        receipt["abi_sha256"] = sha(header)
        # Link and execute a real libbox-dependent executable, not a Go .a archive.
        probe = stage / "cmd/tono-mobile-probe"
        probe.mkdir()
        (probe / "main.go").write_text('package main\nimport ("fmt"; m "' + PACKAGE + '")\nfunc main(){fmt.Println(m.Identity()); if _,e:=m.Prepare(nil,nil,"","");e==nil {panic("invalid admission accepted")}}\n')
        ldflags = "-X " + PACKAGE + ".buildIdentity=" + identity
        binary = Path(tmp) / "probe"
        run([args.go, "build", *flags, "-ldflags", ldflags, "-o", binary, "./cmd/tono-mobile-probe"], stage)
        require(output([binary], stage) == identity, "linked identity mismatch")
        first = sha(binary)
        run([args.go, "build", *flags, "-ldflags", ldflags, "-o", binary, "./cmd/tono-mobile-probe"], stage)
        require(sha(binary) == first, "repeat build differs")
        receipt["host_link_sha256"] = first
        args.out.mkdir(parents=True)
        shutil.copyfile(header, args.out / header.name)
        shutil.copyfile(stage / "go.mod", args.out / "go.mod.lock")
        shutil.copyfile(stage / "go.sum", args.out / "go.sum.lock")
        shutil.copyfile(stage / "LICENSE", args.out / "sing-box-LICENSE.txt")
        shutil.copyfile(tun / "LICENSE", args.out / "sing-tun-LICENSE.txt")
        generator_dir = Path(json.loads(output([args.go, "list", "-m", "-json", "github.com/sagernet/gomobile"], stage))["Dir"])
        shutil.copyfile(generator_dir / "LICENSE", args.out / "gomobile-LICENSE.txt")
        if args.apple:
            env["CGO_ENABLED"] = "1"
            framework = args.out / "Tonomobile.xcframework"
            run([tools / "gomobile", "bind", "-target=" + mobile["targets"], "-iosversion=" + mobile["deployment_target"],
                 "-tags=" + tags, "-trimpath", "-ldflags=" + ldflags, "-o", framework, "./experimental/tonomobile"], stage)
            info = plistlib.loads((framework / "Info.plist").read_bytes())
            libraries = info["AvailableLibraries"]
            require(len(libraries) == 2 and all(x["SupportedArchitectures"] == ["arm64"] for x in libraries), "unexpected Apple slices")
            settings = ["TONO_MOBILE_IDENTITY = " + identity, "OTHER_LDFLAGS = $(inherited) -framework Tonomobile"]
            for item in libraries:
                variant = item.get("SupportedPlatformVariant", "device")
                sdk = "iphonesimulator*" if variant == "simulator" else "iphoneos*"
                directory = framework / item["LibraryIdentifier"]
                require(item["SupportedPlatform"] == "ios" and variant in ("device", "simulator"), "unexpected platform")
                settings.append('FRAMEWORK_SEARCH_PATHS[sdk=' + sdk + '] = $(inherited) "' + str(directory) + '"')
            (args.out / "mobile.xcconfig").write_text("\n".join(settings) + "\n")
            receipt["apple"]["files"] = {str(p.relative_to(framework)): sha(p) for p in sorted(framework.rglob("*")) if p.is_file()}
        else:
            shutil.copyfile(binary, args.out / "host-link-probe")
        require(sha(stage / "go.mod") == patched_mod and sha(stage / "go.sum") == pins["go_sum_sha256"], "module graph drift during build")
        receipt["auxiliary"] = {p.name: sha(p) for p in sorted(args.out.iterdir()) if p.is_file()}
        receipt["checks"] = ["linked packet-flow DNS and close", "actual QUIC leaf DER negatives", "catalog/parser admission", "Objective-C ABI generation", "linked identity execution", "repeat host binary hash"]
        (args.out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "tun-source", "go", "out"):
        parser.add_argument("--" + name, type=lambda s: Path(s).resolve(), required=True)
    parser.add_argument("--apple", action="store_true")
    for name in ("sdk-build", "simulator-sdk-build", "xcode-build"):
        parser.add_argument("--" + name)
    build(parser.parse_args())
