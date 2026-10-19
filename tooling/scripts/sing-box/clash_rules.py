"""Replay a runtime against a real sing-box and compare its Clash `/rules` (#1684).

The Windows App proves a DIRECT reload by reading `/rules` back and comparing each string
with `tono-core`'s prediction (`clash_rules.rs`). This script keeps that prediction honest:
`capture` records what a real core prints for the fixture runtime, `check` fails when the
pinned core prints anything else. Route rules do not depend on inbounds or interfaces, so
the TUN inbound becomes a loopback mixed inbound and nothing needs privileges.
"""

import argparse
import json
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[3]
FIXTURE = ROOT / "tooling/scripts/sing-box/fixtures/alpha9-clash-rules.json"


def free_ports(count):
    """Distinct loopback ports: every probe stays bound until all are chosen."""
    probes = [socket.socket() for _ in range(count)]
    try:
        for probe in probes:
            probe.bind(("127.0.0.1", 0))
        return [probe.getsockname()[1] for probe in probes]
    finally:
        for probe in probes:
            probe.close()


def unprivileged(runtime, ports, secret):
    """Every listener moves to its own fresh loopback port; route rules are untouched."""
    runtime = json.loads(json.dumps(runtime))
    ports = iter(ports)
    for inbound in runtime.get("inbounds", []):
        if inbound["type"] == "tun":
            tag = inbound["tag"]
            inbound.clear()
            inbound.update({"type": "mixed", "tag": tag, "listen": "127.0.0.1", "listen_port": next(ports)})
        elif "listen_port" in inbound:
            inbound["listen_port"] = next(ports)
    for outbound in runtime.get("outbounds", []):
        outbound.pop("bind_interface", None)
    runtime["route"].pop("auto_detect_interface", None)
    runtime["route"].pop("default_interface", None)
    runtime["experimental"]["clash_api"]["external_controller"] = f"127.0.0.1:{next(ports)}"
    runtime["experimental"]["clash_api"]["secret"] = secret
    return runtime


def live_rules(binary, runtime):
    # Fresh ports and secret per replay: a leftover core cannot answer for this one.
    secret = secrets.token_urlsafe(24)
    started = unprivileged(runtime, free_ports(len(runtime.get("inbounds", [])) + 1), secret)
    controller = started["experimental"]["clash_api"]["external_controller"]
    with tempfile.TemporaryDirectory() as work:
        config = Path(work) / "runtime.json"
        config.write_text(json.dumps(started))
        core = subprocess.Popen(
            [binary, "run", "-c", str(config)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
        )
        try:
            request = urllib.request.Request(
                f"http://{controller}/rules", headers={"Authorization": f"Bearer {secret}"}
            )
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline and core.poll() is None:
                try:
                    with urllib.request.urlopen(request, timeout=2) as response:
                        rules = json.loads(response.read())["rules"]
                    if core.poll() is not None:
                        break
                    return [{"type": r["type"], "payload": r["payload"], "proxy": r["proxy"]} for r in rules]
                except OSError:
                    time.sleep(0.2)
        finally:
            core.kill()
            output = core.communicate()[0]
        sys.exit(f"sing-box never served /rules:\n{output[-4000:]}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["capture", "check"])
    parser.add_argument("--binary", required=True)
    parser.add_argument("--runtime", help="capture: runtime JSON emitted by tono-core")
    args = parser.parse_args()
    if args.mode == "capture":
        runtime = json.loads(Path(args.runtime).read_text())
        version = subprocess.run([args.binary, "version"], capture_output=True, text=True, check=True)
        fixture = {
            "source": version.stdout.splitlines()[0],
            "runtime": runtime,
            "rules": live_rules(args.binary, runtime),
        }
        FIXTURE.write_text(json.dumps(fixture, ensure_ascii=False, indent=2) + "\n")
        print(f"wrote {len(fixture['rules'])} rules to {FIXTURE.relative_to(ROOT)}")
        return
    fixture = json.loads(FIXTURE.read_text())
    observed = live_rules(args.binary, fixture["runtime"])
    if observed != fixture["rules"]:
        for index, (seen, recorded) in enumerate(zip(observed, fixture["rules"])):
            if seen != recorded:
                print(f"rule {index}\n  core:    {seen}\n  fixture: {recorded}")
        sys.exit(f"/rules differs from the fixture ({len(observed)} served, {len(fixture['rules'])} recorded)")
    print(f"/rules matches the fixture: {len(observed)} rules")


if __name__ == "__main__":
    main()
