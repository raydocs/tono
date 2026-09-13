#!/usr/bin/env python3
"""B3: fixed cores, two independent long-SSE batches, separate CPU profiles."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent / "stage_b2"))
import batch as b2
prior, configs = b2.prior, b2.configs
IP, command, snapshot, network_snapshot = b2.IP, b2.command, b2.snapshot, b2.network_snapshot
KINDS = prior.KINDS
PRELUDE = b2.REALITY_CASES[:5]
CASES = [("idle", "h1", 0), ("fresh-h1-c1", "h1", 1), ("fresh-h1-c8", "h1", 8),
         ("fresh-h2-c1", "h2", 1), ("fresh-h2-c8", "h2", 8), ("postburst-h1-c1", "h1", 1)]
B2_SHA = "b83bb784e86589d60acd071f93226934a3ba50e1a57bdc6164f37ec1889cd3d5"


def budget():
    prelude = sum(s["count"] * (s.get("prompt_bytes", 4096) + s["response_bytes"] + 8192) for _, s in PRELUDE)
    streams = 2 * 3 * 19 + 6 + 3  # two normal batches; Hy2; CPU-profile SSE
    return {"normal_streams": 114, "hy2_correctness_streams": 6, "profile_streams": 3,
            "seconds_per_stream": 30, "events_per_stream": 600, "payload_bytes_per_event": 128,
            "prelude_bytes_upper_each": prelude, "prelude_count": 9,
            "smoke_selftest_reserve_bytes": 16 << 20,
            "application_bytes_upper": streams * (8192 + 600 * (128 + 256)) + 9 * prelude + (16 << 20),
            "normal_and_diagnostic_wall_budget_seconds": 1800}


def write(path, value):
    path.write_text(json.dumps(value, separators=(",", ":")) + "\n")
    path.chmod(0o600)


def hashes():
    paths = [HERE / "workload.go", HERE / "run_b3.py", HERE.parent / "stage_b2/batch.py",
             HERE.parent / "stage_b/run.py", HERE.parent / "stage_b/configs.py",
             HERE.parent / "stage_b/workload.py", HERE.parent / "bench.py"]
    return {str(p.relative_to(ROOT)): prior.sha(p) for p in paths}


def validated(value, concurrency, proto, cancel=False):
    status = "CANCELLED" if cancel else "PASS"
    samples = value.get("samples", [])
    warm_ids = {w.get("connection_id") for w in value.get("warmup", []) if w["status"] == "PASS"}
    if value.get("status") != status or len(samples) != concurrency:
        return False
    for s in samples:
        if (s["status"] != status or s.get("http_proto") != ("HTTP/2.0" if proto == "h2" else "HTTP/1.1")
            or s.get("tls_alpn") != ("h2" if proto == "h2" else "http/1.1")
            or not s.get("got_conn_reused") or s.get("connection_id") not in warm_ids):
            return False
        if cancel:
            if not s.get("cancel_acknowledged") or s.get("done"):
                return False
        elif not s.get("done") or len(s["events"]) != value["expected_events"]:
            return False
    if proto == "h2":
        return (len({s["connection_id"] for s in samples}) == 1
                and max((e["active"] for s in samples for e in s["events"]), default=0) >= concurrency)
    return len({s["connection_id"] for s in samples}) == concurrency


class Experiment(b2.Experiment):
    def __init__(self, args, result):
        self.args, self.result, self.output = args, result, args.output
        self.processes, self.client = [], None
        self.identity = configs.credentials(self.output / "credentials", args.sing_box)
        self.creds = self.output / "credentials"
        prior.run([IP, "link", "set", "lo", "up"])
        prior.run([IP, "addr", "add", f"{configs.ORIGIN}/32", "dev", "lo"])
        self.holder = self.spawn(["unshare", "--net", "sleep", "1220"], "holder")
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
        self.dns = self.spawn([sys.executable, HERE.parent / "stage_b2/batch.py", "dns", "--host-ns", args.host_ns], "dns")
        server = self.output / "server.json"
        configs.write(server, b2.server_config(self.creds, self.identity))
        self.server = self.spawn(["taskset", "-c", "2,3", args.sing_box, "run", "-c", server], "server")
        prior.wait_for(lambda: self.api_ready(server=True))
        result["server_config_sha256"] = prior.sha(server)
        result["config_summary"] = {"topology": "sealed same-host veth/TUN, no default route/netem",
            "affinity": {"client": [0, 1], "server": [2, 3], "worker": [4, 5], "fixture": [6, 7]},
            "GOMAXPROCS": 2, "mtu": 1500, "TLS": "1.3, owned CA, no session cache",
            "H1_H2": "same origin, ALPN asserted, H2 one connection with concurrent streams",
            "hy2": "bandwidth fields omitted; BBR implementations differ; correctness only",
            "event_bytes": 128, "interval_ms": 50, "duration_seconds": 30,
            "prelude": PRELUDE, "CPU_window": "worker launch through completion; raw before/after retained",
            "native_product": "NOT_TESTED", "profiles_in_normal_rounds": False}

    def start_client(self, kind, label, diagnostic=False):
        prior.ensure(self.client is None, "previous client still owned")
        self.kind, self.label = kind, label
        self.config = self.output / f"{label}.json"
        config = b2.client_config(kind, self.creds, self.identity)
        if diagnostic:
            if kind == "mihomo":
                config["log-level"] = "debug"  # required by upstream profiling router; diagnostic-only
            else:
                config["experimental"]["debug"] = {"listen": "127.0.0.1:19092"}
        configs.write(self.config, config)
        data = self.output / f"{label}-data"
        data.mkdir()
        argv = [self.args.mihomo, "-d", data, "-f", self.config] if kind == "mihomo" else [
            self.args.sing_box, "run", "-D", data, "-c", self.config]
        self.client = self.spawn([*self.prefix, "taskset", "-c", "0,1", *argv], label,
                                 {"SSL_CERT_FILE": str(self.creds / "ca.pem")})
        prior.wait_for(lambda: self.api_ready() and self.client.poll() is None and self.tun_present())
        self.routes()
        self.result.setdefault("config_hashes", {})[label] = prior.sha(self.config)
        proof = self.burst("request")
        self.result.setdefault("startup_proofs", []).append({"label": label, "result": proof})
        prior.ensure(proof["status"] == "PASS", "startup HTTPS proof failed")

    def invoke(self, binary, mode, spec, timeout):
        argv = [*self.prefix, "taskset", "-c", "4,5", binary, "-mode", mode, "-ca", self.creds / "ca.pem"]
        for key, value in spec.items():
            flag = "-" + key.replace("_", "-")
            argv += [flag + "=" + str(value).lower()] if isinstance(value, bool) else [flag, str(value)]
        execution = command([str(a) for a in argv], timeout=timeout)
        try:
            value = json.loads(execution["stdout"])
        except ValueError:
            value = {"status": "FAIL", "samples": [], "error": "worker emitted no valid JSON"}
        value.update(worker_exit_code=execution["exit_code"], worker_wall_ms=execution["elapsed_ms"])
        if execution["status"] != "PASS":
            value["status"] = "FAIL"
            value["invocation_status"] = execution["status"]
        return value

    def burst(self, mode="batch", **spec):
        return self.invoke(self.args.burst_workload, mode, spec, 45)

    def stream(self, protocol, concurrency, **spec):
        return self.invoke(self.args.workload, "batch", dict(protocol=protocol, concurrency=concurrency, **spec), 95)

    def prelude(self):
        result = []
        for name, spec in PRELUDE:
            result.append(dict(self.burst(**spec), name=name))
        return {"status": "PASS" if all(x["status"] == "PASS" for x in result) else "FAIL", "cases": result}

    def observe(self, action):
        observations, done = [], threading.Event()
        def read():
            return {role: prior.usage(p.pid) for role, p in {
                "client": self.client, "server": self.server, "fixture": self.fixture}.items()}
        def sample():
            while not done.is_set():
                observations.append(dict(read(), ns=time.monotonic_ns()))
                done.wait(.25)
        before, start = read(), time.monotonic_ns()
        observer = threading.Thread(target=sample)
        observer.start()
        try:
            value = action()
        finally:
            done.set()
            observer.join()
        value["resources"] = {"before": before, "after": read(), "window_ms": (time.monotonic_ns()-start)/1e6,
                              "samples_250ms": observations}
        return value

    def idle(self):
        start = time.monotonic_ns()
        time.sleep(30)
        return {"status": "PASS", "elapsed_ms": (time.monotonic_ns()-start)/1e6, "samples": []}

    def record(self, kind, name, value, **extra):
        row = dict(value, candidate=kind, case=name, **extra)
        self.result.setdefault("cases", []).append(row)
        write(self.output / "results.json", self.result)
        print(json.dumps({"candidate": kind, "case": name, "status": row["status"]}), flush=True)

    def smoke(self, kind):
        self.start_client(kind, "smoke-" + kind)
        for proto in ["h1", "h2"]:
            for port in [18080, 18081]:
                value = self.stream(proto, 8, port=port, duration="500ms", interval="50ms", timeout="2s")
                self.check(f"{proto}-{port}-reuse-multistream", value, validated(value, 8, proto))
                value = self.stream(proto, 8, port=port, duration="2s", interval="50ms", cancel_after="250ms", timeout="3s")
                self.check(f"{proto}-{port}-cancel-ack", value, validated(value, 8, proto, True))
        value = self.stream("h2", 1, duration="500ms", timeout="100ms")
        self.check("timeout-not-success", value, value["status"] == "FAIL" and value["samples"][0]["status"] == "TIMEOUT")
        value = self.stream("h1", 1, duration="100ms", server_name="wrong.test", timeout="1s")
        self.check("wrong-SNI-not-success", value, value["status"] == "FAIL")
        self.stop_client(crash=True)
        self.start_client(kind, "profile-probe-" + kind, True)
        port = 19090 if kind == "mihomo" else 19092
        result = command([*self.prefix, "curl", "--noproxy", "*", "-fsS", "--max-time", "2",
                          f"http://127.0.0.1:{port}/debug/pprof/"], timeout=3)
        self.check("profile-router-available", {"status": result["status"]}, result["status"] == "PASS")
        self.stop_client()

    def measure(self, kind, number):
        cases = CASES if number == 1 else list(reversed(CASES))
        for name, proto, concurrency in cases:
            self.start_client(kind, f"b{number}-{kind}-{name}")
            prelude = self.prelude() if name.startswith("postburst") else None
            value = self.observe(self.idle if concurrency == 0 else lambda: self.stream(proto, concurrency))
            if concurrency and not validated(value, concurrency, proto):
                value["status"] = "FAIL"
            if prelude and prelude["status"] != "PASS":
                value["status"] = "FAIL"
            self.record(kind, name, value, protocol=proto, concurrency=concurrency, batch=number, prelude=prelude)
            self.stop_client()
        if number == 1:
            for proto in ["h1", "h2"]:
                self.start_client(kind, f"hy2-{kind}-{proto}")
                value = self.observe(lambda: self.stream(proto, 1, port=18081))
                if not validated(value, 1, proto):
                    value["status"] = "FAIL"
                cancelled = self.stream(proto, 1, port=18081, duration="2s", cancel_after="250ms", timeout="3s")
                self.record(kind, "hy2-correctness-" + proto, value, protocol=proto, concurrency=1, batch=number,
                            cancellation=cancelled, cancel_verified=validated(cancelled, 1, proto, True))
                self.stop_client()

    def profile(self, kind):
        for case in ["idle", "fresh-h1-c1", "burst"]:
            self.start_client(kind, f"profile-{kind}-{case}", True)
            port = 19090 if kind == "mihomo" else 19092
            path = self.output / f"{kind}-{case}.pprof"
            process = self.spawn([*self.prefix, "curl", "--noproxy", "*", "-fsS", "--max-time", "38",
                "--max-filesize", "16777216", "-o", path,
                f"http://127.0.0.1:{port}/debug/pprof/profile?seconds=32"], f"profile-fetch-{kind}-{case}")
            time.sleep(.4)
            action = self.idle if case == "idle" else self.prelude if case == "burst" else lambda: self.stream("h1", 1)
            value = self.observe(action)
            try:
                code = process.wait(timeout=40)
            except subprocess.TimeoutExpired:
                b2.prior.stop(process)
                code = -1
            proof = {"exit_code": code, "path": str(path), "sha256": prior.sha(path) if path.exists() else None,
                     "bytes": path.stat().st_size if path.exists() else 0, "profile_seconds": 32,
                     "lead_in_ms": 400, "log_level": "debug" if kind == "mihomo" else "warn"}
            if code or not proof["bytes"]:
                value["status"] = "FAIL"
            self.record(kind, case, value, diagnostic=True, profile=proof)
            self.stop_client()


def build(args):
    out = b2.new_output(args.output)
    prior.ensure(subprocess.check_output([str(args.go), "env", "GOVERSION"], text=True).strip() == "go1.27.1", "Go identity")
    env = ["env", "GOTOOLCHAIN=local", "GO111MODULE=off", "CGO_ENABLED=0", "GOARCH=amd64", "GOAMD64=v2", "GOOS=linux", "GOMAXPROCS=2"]
    records = []
    for argv in [[*env, str(args.go), "test", "-c", "-o", str(out / "tests"), str(HERE / "workload.go"), str(HERE / "workload_test.go")],
                 ["sudo", "-n", "timeout", "--kill-after=2s", "60s", "unshare", "--net", "--pid", "--mount", "--mount-proc", "--fork", "--kill-child=SIGKILL", "sh", "-c", f'{IP} link set lo up; exec "$1" -test.v', "sh", str(out / "tests")],
                 [*env, str(args.go), "build", "-trimpath", "-ldflags", "-s -w -buildid=", "-o", str(out / "workload"), str(HERE / "workload.go")]]:
        result = command(argv, timeout=120)
        records.append(result)
        write(out / "build.json", records)
        prior.ensure(result["status"] == "PASS", "build/selftest failure; see build.json")
    write(out / "manifest.json", {"go": "go1.27.1", "source_sha256": prior.sha(HERE / "workload.go"),
                                  "binary_sha256": prior.sha(out / "workload"), "build": records})
    print("PASS: build and four HTTPS/SSE selftests")


def inner(args):
    prior.ensure(os.getpid() == 1 and os.readlink("/proc/self/ns/net") != args.host_ns, "refuse host/non-PID1")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    result = {"run_id": args.output.name, "mode": args.action, "batch": args.batch, "status": "FAIL",
              "source_hashes": hashes(), "binaries": {k: prior.sha(getattr(args, k)) for k in ["mihomo", "sing_box", "workload", "burst_workload"]},
              "clock_ticks_per_second": os.sysconf("SC_CLK_TCK"), "budget": budget(), "environment_before": snapshot()}
    experiment = None
    try:
        experiment = Experiment(args, result)
        order = KINDS if args.batch == 1 else list(reversed(KINDS))
        for kind in order:
            if args.action == "smoke":
                experiment.smoke(kind)
            elif args.action == "measure":
                experiment.measure(kind, args.batch)
            else:
                experiment.profile(kind)
        prior.ensure(all(c["status"] == "PASS" and c.get("cancel_verified", True) for c in result.get("cases", [])), "failed cases retained")
        result["status"] = "PASS"
    except (Exception, KeyboardInterrupt, SystemExit) as error:
        result["error"] = repr(error)
    finally:
        if experiment:
            experiment.close()
        result["environment_after"] = snapshot()
        write(args.output / "results.json", result)
    return 0 if result["status"] == "PASS" else 1


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("action", choices=["budget", "build", "smoke", "measure", "profile"])
    for name in ["output", "go", "mihomo", "sing-box", "workload", "burst-workload", "build-manifest", "gate"]:
        p.add_argument("--" + name, type=Path)
    p.add_argument("--batch", type=int, choices=[1, 2], default=1)
    p.add_argument("--inside", action="store_true")
    p.add_argument("--host-ns")
    args = p.parse_args()
    prior.ensure(budget()["application_bytes_upper"] < 256 << 20, "traffic budget exceeded")
    if args.action == "budget":
        print(json.dumps(budget(), indent=2)); return 0
    if args.action == "build":
        build(args); return 0
    prior.ensure(prior.sha(args.mihomo) == prior.MIHOMO_SHA and prior.sha(args.sing_box) == prior.SING_SHA and prior.sha(args.burst_workload) == B2_SHA, "fixed binary identity mismatch")
    manifest = json.loads(args.build_manifest.read_text())
    prior.ensure(prior.sha(args.workload) == manifest["binary_sha256"] and prior.sha(HERE / "workload.go") == manifest["source_sha256"], "workload identity mismatch")
    if args.inside:
        return inner(args)
    if args.action in ["measure", "profile"]:
        gate = json.loads(args.gate.read_text())
        prior.ensure(gate["status"] == "PASS" and gate["source_hashes"] == hashes(), "unchanged smoke required")
    out = b2.new_output(args.output)
    before = network_snapshot()
    argv = ["sudo", "-n", "timeout", "--signal=TERM", "--kill-after=2s", "1200s", "unshare", "--net", "--pid", "--mount", "--mount-proc", "--fork", "--kill-child=SIGKILL",
            sys.executable, str(HERE / "run_b3.py"), args.action, "--inside", "--host-ns", before["namespace"], "--output", str(out), "--batch", str(args.batch)]
    for key in ["mihomo", "sing_box", "workload", "burst_workload", "build_manifest"]:
        argv += ["--" + key.replace("_", "-"), str(getattr(args, key).resolve())]
    execution = command(argv, timeout=1210)
    prior.run(["sudo", "-n", "chown", "-R", f"{os.getuid()}:{os.getgid()}", out])
    after = network_snapshot()
    write(out / "execution.json", execution)
    write(out / "host-network.json", {"unchanged": before == after, "before": before, "after": after})
    value = json.loads((out / "results.json").read_text())
    live = prior.run(["sudo", "-n", "lsns", "-t", "net", "-n", "-o", "NS"])
    gone = all(ns.split("[")[1].rstrip("]") not in live.split() for ns in value.get("namespaces", []))
    write(out / "cleanup.json", {"namespaces_gone": gone, "root_visible_namespaces": live.split()})
    prior.ensure(before == after and gone, "isolation cleanup invariant failed")
    print(json.dumps({k: value.get(k) for k in ["run_id", "status", "error"]}))
    return 0 if execution["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
