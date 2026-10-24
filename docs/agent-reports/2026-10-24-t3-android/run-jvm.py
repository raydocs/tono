#!/usr/bin/env python3
"""Evidence harness: run the pure T3 lifecycle/status/propagation tests without AGP or libbox.

Uses real JUnit and existing local compiler/SDK jars; never downloads anything.
This is a focused source check, not the Android/AGP build or Robolectric suite.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--junit-dir", type=Path, required=True,
                        help="directory containing junit-4.13.2.jar and hamcrest-core-1.3.jar")
    parser.add_argument("--gradle-lib", type=Path, required=True, help="existing Gradle distribution lib directory (Kotlin compiler 2.3.20)")
    parser.add_argument("--output", type=Path,
                        help="new directory for retained class files, commands and logs")
    args = parser.parse_args()
    java_home = os.environ.get("JAVA_HOME")
    sdk_home = os.environ.get("ANDROID_HOME")
    if not java_home or not sdk_home:
        parser.error("set JAVA_HOME and ANDROID_HOME to existing installations")
    lib = args.gradle_lib.resolve()
    compiler = sorted(lib.glob("*.jar"))
    stdlib = lib / "kotlin-stdlib-2.3.20.jar"
    java = Path(java_home) / "bin/java"
    sdk = Path(sdk_home) / "platforms/android-36/android.jar"
    junit = args.junit_dir.resolve() / "junit-4.13.2.jar"
    hamcrest = args.junit_dir.resolve() / "hamcrest-core-1.3.jar"
    for path in (java, sdk, junit, hamcrest):
        if not path.is_file():
            parser.error(f"missing existing input: {path}; nothing installed")
    output = args.output.resolve() if args.output else Path(tempfile.mkdtemp(prefix="tono-state-junit-"))
    if args.output:
        output.mkdir(parents=True, exist_ok=False)  # Never overwrite retained evidence.
    classes = output / "classes"
    classes.mkdir()
    android = Path(__file__).resolve().parents[3] / "apps/android"
    mobile = android / "mobile/src"
    tests = ("engine.PropagationWaitTest", "engine.StopPersistenceTest", "engine.DnsCompletionTest", "engine.TunnelAuthorityTest", "surface.SurfaceRulesTest",
             "surface.StatusFileTest", "surface.ClaimRulesTest")
    sources = sorted((android / "routing/src/main/kotlin").rglob("*.kt"))
    sources += [mobile / "main/kotlin/com/raydocs/tono/mobile" / name for name in (
        "engine/PropagationWait.kt", "engine/ControlPlane.kt", "engine/LocalTestServer.kt", "engine/StopPersistence.kt", "engine/DnsCompletion.kt", "engine/EngineSnapshot.kt", "engine/TunnelAuthority.kt", "surface/PublicStatus.kt", "surface/ClaimRules.kt")]
    sources += [mobile / "test/kotlin/com/raydocs/tono/mobile" / (name.replace(".", "/") + ".kt") for name in tests]
    # Only the generated DEBUG flag is needed by the real ControlPlane/LocalTestServer.
    generated = output / "BuildConfig.kt"
    generated.write_text("package com.raydocs.tono.mobile\nobject BuildConfig { const val DEBUG = true }\n")
    sources += [generated]
    inputs = sources + compiler + [java, sdk, junit, hamcrest]
    (output / "inputs.sha256.json").write_text(json.dumps(
        {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in inputs}, indent=2) + "\n")
    cp = os.pathsep.join(map(str, (stdlib, sdk, junit, hamcrest)))
    compile_cmd = [str(java), "-cp", os.pathsep.join(map(str, compiler)),
                   "org.jetbrains.kotlin.cli.jvm.K2JVMCompiler", "-no-stdlib", "-no-reflect",
                   "-jvm-target", "17", "-classpath", cp, "-d", str(classes)] + list(map(str, sources))
    junit_cmd = [str(java), "-cp", str(classes) + os.pathsep + cp, "org.junit.runner.JUnitCore"]
    junit_cmd += ["com.raydocs.tono.mobile." + name for name in tests]
    print(f"Evidence: {output}", flush=True)
    for name, cmd in (("compile", compile_cmd), ("junit", junit_cmd)):
        (output / f"{name}-command.txt").write_text(shlex.join(cmd) + "\n")
        result = subprocess.run(cmd, capture_output=True, text=True)
        text = result.stdout + result.stderr
        (output / f"{name}.log").write_text(text)
        print(text, end="", flush=True)
        print(f"{name} exit: {result.returncode}", flush=True)
        if result.returncode:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
