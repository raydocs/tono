#!/usr/bin/env python3
"""Independent B2 AI-request batch; no sustained upload/download workloads."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import signal
import socketserver
import subprocess
import sys
import threading
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent / "stage_b"))
import run as prior
import configs
from workload import DNS
from bench import IP, command, network_snapshot, snapshot

KINDS = prior.KINDS
REALITY_CASES = [
    ("cold-burst-c1", {"count": 24, "concurrency": 1, "reuse": False, "response_bytes": 128 << 10}),
    ("reuse-burst-c1", {"count": 32, "concurrency": 1, "response_bytes": 128 << 10}),
    ("burst-c8", {"count": 40, "concurrency": 8, "response_bytes": 128 << 10}),
    ("burst-c16", {"count": 40, "concurrency": 16, "response_bytes": 128 << 10}),
    ("prompt-32k", {"count": 8, "prompt_bytes": 32 << 10, "response_bytes": 32 << 10}),
    ("sse-c1", {"count": 8, "path": "/ai/stream", "response_bytes": 64 << 10}),
    ("sse-c8", {"count": 16, "concurrency": 8, "path": "/ai/stream", "response_bytes": 64 << 10})]
HY2_CASES = [("backup-burst", {"count": 8, "response_bytes": 32 << 10}),
             ("backup-sse", {"count": 2, "path": "/ai/stream", "response_bytes": 64 << 10})]


def payload_budget():
    # Fixed request counts plus generous JSON/SSE framing allowance; no retry loop.
    per_round = sum(spec["count"] * (spec.get("prompt_bytes", 4096) + spec["response_bytes"] + 8192)
                    for _, spec in REALITY_CASES + HY2_CASES)
    return 9 * (per_round + 2 * 16384)


def new_output(path):
    path = path.resolve()
    for line in subprocess.check_output(["git", "worktree", "list", "--porcelain"], cwd=ROOT, text=True).splitlines():
        if line.startswith("worktree "):
            prior.ensure(not path.is_relative_to(Path(line[9:]).resolve()), "output must be outside all worktrees")
    path.mkdir(parents=True, exist_ok=False)
    path.chmod(0o700)
    return path


def source_hashes():
    paths = [HERE / name for name in ["batch.py", "workload.go"]]
    paths += [HERE.parent / "stage_b" / name for name in ["run.py", "configs.py", "workload.py"]]
    paths += [HERE.parent / "bench.py"]
    return {str(p.relative_to(ROOT)): prior.sha(p) for p in paths}


def client_config(kind, directory, identity, variant="normal"):
    value = configs.client_config(kind, directory, identity, variant)
    for outbound in value.get("proxies", value.get("outbounds", [])):
        for key in ["up", "down", "up_mbps", "down_mbps"]:
            outbound.pop(key, None)
    return value


def server_config(directory, identity):
    value = configs.server_config(directory, identity)
    for inbound in value["inbounds"]:
        inbound.pop("up_mbps", None)
        inbound.pop("down_mbps", None)
    return value


class Experiment(prior.Experiment):
    def __init__(self, args, result):
        self.args, self.result, self.output = args, result, args.output
        self.processes, self.client = [], None
        self.identity = configs.credentials(self.output / "credentials", args.sing_box)
        self.creds = self.output / "credentials"
        prior.run([IP, "link", "set", "lo", "up"])
        prior.run([IP, "addr", "add", f"{configs.ORIGIN}/32", "dev", "lo"])
        self.holder = self.spawn(["unshare", "--net", "sleep", "620"], "holder")
        own = os.readlink("/proc/self/ns/net")
        prior.wait_for(lambda: os.readlink(f"/proc/{self.holder.pid}/ns/net") != own)
        self.prefix = ["nsenter", "-t", str(self.holder.pid), "-n"]
        result["namespaces"] = [own, os.readlink(f"/proc/{self.holder.pid}/ns/net")]
        prior.run([IP, "link", "add", "bench-server", "type", "veth", "peer", "name", "bench-link"])
        prior.run([IP, "link", "set", "bench-link", "netns", self.holder.pid])
        prior.run([IP, "addr", "add", f"{configs.SERVER}/30", "dev", "bench-server"])
        prior.run([IP, "link", "set", "bench-server", "up"])
        for cmd in [["link", "set", "lo", "up"], ["addr", "add", "10.203.0.2/30", "dev", "bench-link"],
                    ["link", "set", "bench-link", "up"]]:
            prior.run([*self.prefix, IP, *cmd])
        self.fixture = self.spawn(["taskset", "-c", "6,7", args.workload, "-mode", "fixture",
                                   "-directory", self.creds], "fixture")
        self.dns = self.spawn([sys.executable, HERE / "batch.py", "dns", "--host-ns", args.host_ns], "dns")
        server = self.output / "server.json"
        configs.write(server, server_config(self.creds, self.identity))
        self.server = self.spawn(["taskset", "-c", "2,3", args.sing_box, "run", "-c", server], "server")
        prior.wait_for(lambda: self.api_ready(server=True))
        result["config_summary"] = {
            "link": "same-host veth, no external NIC/default route, no netem", "mtu": 1500,
            "core_cpus": [0, 1], "server_cpus": [2, 3], "workload_cpus": [4, 5], "origin_cpus": [6, 7],
            "GOMAXPROCS": 2, "hy2_bandwidth_fields": "omitted on both ends; BBR; no configured ceiling",
            "application": "TLS1.3 HTTP1.1, owned CA, no TLS session cache, no retries",
            "mux": False, "application_payload_budget": payload_budget(), "root_watchdog_seconds": 600,
            "sse": {"events": 16, "initial_generation_delay_ms": 40, "event_generation_interval_ms": 20},
            "primary": "Reality AI POST/JSON and SSE", "hy2": "backup request validation only",
            "native_click_and_Connected": "NOT_TESTED; harness start intent only"}

    def start_client(self, kind, label, variant="normal"):
        prior.ensure(self.client is None, "previous candidate still owned")
        self.intent_ns = time.monotonic_ns()
        self.kind, self.label = kind, label
        self.config = self.output / f"{label}.json"
        configs.write(self.config, client_config(kind, self.creds, self.identity, variant))
        data = self.output / f"{label}-data"
        data.mkdir()
        argv = [self.args.mihomo, "-d", data, "-f", self.config] if kind == "mihomo" else [
            self.args.sing_box, "run", "-D", data, "-c", self.config]
        ca = self.creds / ("wrong-ca.pem" if variant == "wrong-ca" else "ca.pem")
        self.client = self.spawn([*self.prefix, "taskset", "-c", "0,1", *argv], label,
                                 {"SSL_CERT_FILE": str(ca)})
        prior.wait_for(lambda: self.api_ready() and self.client.poll() is None and self.tun_present())
        self.ready_ns = time.monotonic_ns()
        self.routes()
        self.routes_ns = time.monotonic_ns()
        self.result.setdefault("config_hashes", {})[label] = prior.sha(self.config)

    def tun_present(self):
        links = json.loads(prior.run([*self.prefix, IP, "-j", "link", "show"]))
        return any(link["ifname"] == configs.TUN for link in links)

    def https(self, mode="request", **spec):
        argv = [*self.prefix, "taskset", "-c", "4,5", self.args.workload,
                "-mode", mode, "-ca", self.creds / "ca.pem"]
        for key, value in spec.items():
            flag = "-" + key.replace("_", "-")
            argv += [flag + "=" + str(value).lower()] if isinstance(value, bool) else [flag, str(value)]
        execution = command([str(v) for v in argv], timeout=45)
        try:
            value = json.loads(execution["stdout"])
        except (ValueError, TypeError):
            # Keep a failed invocation in its case even when no JSON was emitted.
            value = {"status": execution["status"] if execution["status"] != "PASS" else "FAIL",
                     "error": "worker produced no JSON", "samples": [], "stderr": execution["stderr"][:2000]}
        value["worker_exit_code"] = execution["exit_code"]
        value["worker_wall_ms"] = execution["elapsed_ms"]
        if execution["status"] != "PASS" and value["status"] == "PASS":
            value["status"] = "FAIL"
        return value

    def lifecycle(self, port, round_number):
        value = self.https(port=port)
        end = time.monotonic_ns()
        record = {"candidate": self.kind, "round": round_number, "port": port,
                  "status": value["status"], "intent_to_core_ready_ms": (self.ready_ns-self.intent_ns)/1e6,
                  "intent_to_routes_ready_ms": (self.routes_ns-self.intent_ns)/1e6,
                  "intent_to_verified_https_ms": (end-self.intent_ns)/1e6,
                  "ready_to_verified_https_ms": (end-self.ready_ns)/1e6, "https": value}
        self.result.setdefault("lifecycle", []).append(record)
        configs.write(self.output / "results.json", self.result)
        return value

    def observed(self, mode, **spec):
        observations, finished = [], threading.Event()
        def read():
            return {role: prior.usage(pid) for role, pid in {
                "client": self.client.pid, "server": self.server.pid, "fixture": self.fixture.pid}.items()}
        def sample():
            try:
                while not finished.is_set():
                    observations.append(dict(read(), ns=time.monotonic_ns()))
                    finished.wait(.1)
            except OSError:
                return
        before = read()
        observer = threading.Thread(target=sample)
        observer.start()
        try:
            value = self.https(mode, **spec)
        finally:
            finished.set()
            observer.join()
        value["resources"] = {"before": before, "after": read(), "samples_100ms": observations}
        return value

    def smoke(self, kind):
        self.start_client(kind, f"smoke-{kind}")
        for port in [18080, 18081]:
            value = self.https(port=port)
            self.check(f"HTTPS-TUN-{port}", value, value["status"] == "PASS")
        for tcp in [False, True]:
            dns = self.work("dns", name="reality.bench.test", tcp=tcp)
            value = self.https(address=dns["addresses"][0])
            self.check(f"DNS-fake-IP-HTTPS-{tcp}", {"dns": dns, "request": value}, value["status"] == "PASS")
        for name, spec in [("origin-wrong-CA", {"ca": self.creds / "wrong-ca.pem"}),
                           ("origin-wrong-SNI", {"server_name": "wrong.test"}),
                           ("HTTP-503", {"path": "/ai/failure"}),
                           ("incomplete-SSE", {"path": "/ai/truncated-stream"}),
                           ("deadline", {"path": "/ai/slow", "timeout": "50ms"})]:
            value = self.https(**spec)
            expected = "TIMEOUT" if name == "deadline" else "FAIL"
            self.check(name, value, value["status"] == expected)
        reused = self.https("batch", reuse=True, count=3)
        samples = reused["samples"]
        self.check("actual-HTTPS-reuse", reused, reused["status"] == "PASS" and len(samples) == 3
                   and all(s["reused"] and s["connection_id"] == samples[0]["connection_id"] for s in samples[1:]))
        with ThreadPoolExecutor(max_workers=2) as pool:
            requests = [pool.submit(self.https, path="/ai/stream", port=port) for port in [18080, 18081]]
            time.sleep(.15)
            connections = json.loads(self.api("/connections")["body"])["connections"]
            flows = [{"chains": c["chains"], "port": c["metadata"]["destinationPort"]} for c in connections]
            replies = [future.result() for future in requests]
        self.check("both-owned-outbounds", {"flows": flows, "requests": replies},
                   {"reality", "hy2"} <= {chain for f in flows for chain in f["chains"]}
                   and all(r["status"] == "PASS" for r in replies))
        value = self.https("batch", count=8, concurrency=8, response_bytes=128 << 10)
        self.check("AI-burst-c8", value, value["status"] == "PASS")
        self.stop_client(crash=True)
        value = self.https(timeout="200ms")
        self.check("crash-no-origin-route", value, value["status"] != "PASS")
        for variant in ["wrong-sni", "wrong-ca", "wrong-reality"]:
            self.start_client(kind, f"{kind}-{variant}", variant)
            bad_port = 18080 if variant == "wrong-reality" else 18081
            value = self.https(port=bad_port, timeout="2s")
            self.check(variant, value, value["status"] != "PASS")
            value = self.https(port=18081 if bad_port == 18080 else 18080)
            self.check(variant + "-unaffected", value, value["status"] == "PASS")
            self.stop_client()

    def measure(self, kind, number):
        self.start_client(kind, f"r{number}-{kind}")
        self.lifecycle(18080, number)
        record = {"candidate": kind, "round": number, "cases": []}
        self.result.setdefault("rounds", []).append(record)
        for name, spec in REALITY_CASES:
            value = self.observed("batch", **spec)
            record["cases"].append(dict(value, name=name, mode="batch", arguments=spec))
            configs.write(self.output / "results.json", self.result)
        record["TUN_counters"] = json.loads(prior.run([*self.prefix, IP, "-s", "-j", "link", "show", configs.TUN]))
        self.stop_client()
        # A separate fresh core proves the Hy2 startup path, not a warmed transport after Reality.
        self.start_client(kind, f"r{number}-{kind}-hy2-start")
        self.lifecycle(18081, number)
        for name, spec in HY2_CASES:
            value = self.observed("batch", port=18081, **spec)
            record["cases"].append(dict(value, name=name, mode="batch", arguments=dict(spec, port=18081)))
            configs.write(self.output / "results.json", self.result)
        record["status"] = "PASS" if all(c["status"] == "PASS" for c in record["cases"]) else "FAIL"
        self.stop_client()


def inner(args):
    prior.ensure(os.getpid() == 1 and os.readlink("/proc/self/ns/net") != args.host_ns, "refuse host/non-PID1")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    result = {"run_id": args.output.name, "mode": args.action, "status": "FAIL", "gate_passed": False,
              "source_hashes": source_hashes(), "binaries": {name: prior.sha(getattr(args, name))
                for name in ["mihomo", "sing_box", "workload"]}, "environment_before": snapshot(),
              "clock_ticks_per_second": os.sysconf("SC_CLK_TCK")}
    experiment = None
    try:
        experiment = Experiment(args, result)
        if args.action == "smoke":
            for kind in KINDS:
                experiment.smoke(kind)
            result["gate_passed"] = True
        else:
            orders = [KINDS, ["go", "mihomo", "gvisor"], ["gvisor", "go", "mihomo"]]
            for number, order in enumerate(orders, 1):
                for kind in order:
                    experiment.measure(kind, number)
            prior.ensure(all(r["status"] == "PASS" for r in result["rounds"])
                         and all(r["status"] == "PASS" for r in result["lifecycle"]), "failed samples retained")
        result["status"] = "PASS"
    except (Exception, KeyboardInterrupt, SystemExit) as error:
        result["error"] = repr(error)
    finally:
        if experiment:
            experiment.close()
        result["environment_after"] = snapshot()
        configs.write(args.output / "results.json", result)
    return 0 if result["status"] == "PASS" else 1


def build(args):
    out = new_output(args.output)
    prior.ensure(subprocess.check_output([str(args.go), "env", "GOVERSION"], text=True).strip() == "go1.27.1", "Go version mismatch")
    env = ["env", "GOTOOLCHAIN=local", "GO111MODULE=off", "CGO_ENABLED=0", "GOARCH=amd64",
           "GOAMD64=v2", "GOOS=linux", "GOMAXPROCS=2"]
    binary, test = out / "https-workload", out / "workload-tests"
    commands = [
        [*env, str(args.go), "test", "-c", "-o", str(test), str(HERE / "workload.go"), str(HERE / "workload_test.go")],
        ["sudo", "-n", "timeout", "--kill-after=2s", "60s", "unshare", "--net", "--pid", "--mount", "--mount-proc",
         "--fork", "--kill-child=SIGKILL", "sh", "-c", f"{IP} link set lo up; exec \"$1\" -test.v", "sh", str(test)],
        [*env, str(args.go), "build", "-trimpath", "-ldflags", "-s -w -buildid=", "-o", str(binary), str(HERE / "workload.go")]]
    records = []
    for argv in commands:
        value = command(argv, timeout=120)
        records.append(value)
        configs.write(out / "build.json", records)
        prior.ensure(value["status"] == "PASS", "build/test failed; see build.json")
    manifest = {"go": "go1.27.1", "source_sha256": prior.sha(HERE / "workload.go"),
                "binary_sha256": prior.sha(binary), "build": records}
    configs.write(out / "manifest.json", manifest)
    print(json.dumps({"status": "PASS", "binary": str(binary), "sha256": manifest["binary_sha256"]}))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "smoke", "measure", "dns"])
    for name in ["output", "go", "mihomo", "sing-box", "workload", "build-manifest", "gate"]:
        parser.add_argument("--" + name, type=Path)
    parser.add_argument("--inside", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--host-ns", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.action == "dns":
        prior.ensure(args.host_ns and os.readlink("/proc/self/ns/net") != args.host_ns, "DNS fixture requires isolation")
        socketserver.UDPServer((configs.SERVER, 5300), DNS).serve_forever()
    if args.action == "build":
        return build(args)
    prior.ensure(payload_budget() < 240 << 20, "AI request plan exceeds small-traffic budget")
    prior.ensure(prior.sha(args.mihomo) == prior.MIHOMO_SHA and prior.sha(args.sing_box) == prior.SING_SHA, "core identity changed")
    manifest = json.loads(args.build_manifest.read_text())
    prior.ensure(prior.sha(args.workload) == manifest["binary_sha256"] and prior.sha(HERE / "workload.go") == manifest["source_sha256"], "workload identity changed")
    if args.inside:
        return inner(args)
    if args.action == "measure":
        gate = json.loads(args.gate.read_text())
        prior.ensure(gate["status"] == "PASS" and gate["gate_passed"] and gate["source_hashes"] == source_hashes(), "fresh unchanged smoke gate required")
        prior.ensure(gate["binaries"]["workload"] == prior.sha(args.workload), "workload differs from gate")
    output = new_output(args.output)
    before = network_snapshot()
    argv = ["sudo", "-n", "timeout", "--signal=TERM", "--kill-after=2s", "600s", "unshare", "--net", "--pid",
            "--mount", "--mount-proc", "--fork", "--kill-child=SIGKILL", sys.executable, str(HERE / "batch.py"),
            args.action, "--inside", "--host-ns", before["namespace"], "--output", str(output)]
    for name in ["mihomo", "sing_box", "workload", "build_manifest"]:
        argv += ["--" + name.replace("_", "-"), str(getattr(args, name).resolve())]
    execution = command(argv, timeout=610)
    prior.run(["sudo", "-n", "chown", "-R", f"{os.getuid()}:{os.getgid()}", output])
    after = network_snapshot()
    configs.write(output / "execution.json", execution)
    configs.write(output / "host-network.json", {"unchanged": before == after, "before": before, "after": after})
    prior.ensure(before == after, "host network changed")
    value = json.loads((output / "results.json").read_text())
    live = prior.run(["sudo", "-n", "lsns", "-t", "net", "-n", "-o", "NS"])
    gone = all(ns.split("[")[1].rstrip("]") not in live.split() for ns in value.get("namespaces", []))
    configs.write(output / "cleanup.json", {"namespaces_gone": gone, "root_visible_namespaces": live.split()})
    prior.ensure(gone, "owned namespace remains")
    print(json.dumps({k: value.get(k) for k in ["run_id", "status", "gate_passed", "error"]}))
    return 0 if execution["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
