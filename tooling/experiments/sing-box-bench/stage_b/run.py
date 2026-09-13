#!/usr/bin/env python3
"""Restricted Stage B: owned namespaces, parity gate, then serial real-TUN rounds."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from bench import IP, command, network_snapshot, snapshot, stop
from configs import DNS_ENDPOINT, ORIGIN, SERVER, TUN, client_config, credentials, server_config, write

MIHOMO_SHA = "c685870dc7b97014ac2044013cdbe83d8fedbf9da238b9f59dc64c12933d88a4"
SING_SHA = "cd2ba002e1282da29674107cc503285dc8fa7026bf01fcc40d314bc10ab749df"
KINDS = ["mihomo", "gvisor", "go"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def ensure(ok, message):
    if not ok:
        raise RuntimeError(message)


def run(argv, timeout=10):
    result = command([str(arg) for arg in argv], timeout)
    ensure(result["status"] == "PASS", f"command failed: {result}")
    return result["stdout"]


def wait_for(action, deadline=5):
    end = time.monotonic() + deadline
    while time.monotonic() < end:
        if action():
            return
        time.sleep(.03)
    raise TimeoutError("readiness predicate not met")


def usage(pid):
    stat = Path(f"/proc/{pid}/stat").read_text().split(") ", 1)[1].split()
    status = dict(line.split(":", 1) for line in Path(f"/proc/{pid}/status").read_text().splitlines())
    return {"cpu_ticks": int(stat[11]) + int(stat[12]),
            "rss_kib": int(status.get("VmRSS", "0 kB").split()[0]),
            "fd_count": len(list(Path(f"/proc/{pid}/fd").iterdir()))}


class Experiment:
    def __init__(self, args, result):
        self.args, self.result, self.output = args, result, args.output
        self.processes = []
        self.client = None
        self.identity = credentials(self.output / "credentials", args.sing_box)
        self.creds = self.output / "credentials"
        run([IP, "link", "set", "lo", "up"])
        run([IP, "addr", "add", f"{ORIGIN}/32", "dev", "lo"])
        self.holder = self.spawn(["unshare", "--net", "sleep", "230"], "holder")
        own = os.readlink("/proc/self/ns/net")
        wait_for(lambda: os.readlink(f"/proc/{self.holder.pid}/ns/net") != own)
        self.prefix = ["nsenter", "-t", str(self.holder.pid), "-n"]
        result["namespaces"] = [own, os.readlink(f"/proc/{self.holder.pid}/ns/net")]
        run([IP, "link", "add", "bench-server", "type", "veth", "peer", "name", "bench-link"])
        run([IP, "link", "set", "bench-link", "netns", str(self.holder.pid)])
        run([IP, "addr", "add", f"{SERVER}/30", "dev", "bench-server"])
        run([IP, "link", "set", "bench-server", "up"])
        for command_args in [["link", "set", "lo", "up"],
                             ["addr", "add", "10.203.0.2/30", "dev", "bench-link"],
                             ["link", "set", "bench-link", "up"]]:
            run([*self.prefix, IP, *command_args])
        self.fixture = self.spawn(["taskset", "-c", "6,7", sys.executable, HERE / "workload.py",
                                   "fixture", "--directory", self.creds], "fixture")
        server = self.output / "server.json"
        write(server, server_config(self.creds, self.identity))
        self.server = self.spawn(["taskset", "-c", "2,3", args.sing_box, "run", "-c", server], "server")
        wait_for(lambda: self.api_ready(server=True))
        result["topology"] = {"link": "veth same host, MTU 1500, no netem, no default routes",
                              "client_cpus": [0, 1], "server_cpus": [2, 3],
                              "load_cpus": [4, 5], "fixture_cpus": [6, 7], "GOMAXPROCS": 2}

    def spawn(self, argv, name, extra_env=None):
        with (self.output / f"{name}.log").open("w") as log:
            process = subprocess.Popen([str(arg) for arg in argv], stdout=log, stderr=log,
                                       env=dict(os.environ, GOMAXPROCS="2", PYTHONDONTWRITEBYTECODE="1",
                                                **(extra_env or {})))
        self.processes.append(process)
        return process

    def api(self, path, method="GET", body=None, server=False):
        # Credentials stay in a mode-600 file, never command-line arguments or raw results.
        spec = self.output / "api-request.json"
        write(spec, {"path": path, "method": method, "body": body,
                     "secret": self.identity["controller"], "port": 19091 if server else 19090})
        prefix = [] if server else self.prefix
        execution = command([*prefix, sys.executable, str(HERE / "run.py"), "api", "--output", str(spec)], 3)
        ensure(execution["status"] == "PASS", "controller unavailable")
        return json.loads(execution["stdout"])

    def api_ready(self, server=False):
        try:
            return self.api("/version", server=server)["status"] == 200
        except Exception:
            return False

    def start_client(self, kind, label, variant="normal"):
        ensure(self.client is None, "candidates must be serial")
        self.kind, self.label = kind, label
        self.config = self.output / f"{label}.json"
        write(self.config, client_config(kind, self.creds, self.identity, variant))
        data = self.output / f"{label}-data"
        data.mkdir()
        if kind == "mihomo":
            argv = [self.args.mihomo, "-d", data, "-f", self.config]
        else:
            argv = [self.args.sing_box, "run", "-D", data, "-c", self.config]
        # Go's process-local CA override is read before Mihomo constructs outbound TLS pools.
        # No host trust-store edit. The YAML custom-CA field is applied too late for this path.
        ca = self.creds / ("wrong-ca.pem" if variant == "wrong-ca" else "ca.pem")
        self.client = self.spawn([*self.prefix, "taskset", "-c", "0,1", *argv], label,
                                 {"SSL_CERT_FILE": str(ca)})
        wait_for(lambda: self.api_ready() and self.client.poll() is None)
        self.routes()
        self.result.setdefault("config_hashes", {})[label] = sha(self.config)

    def routes(self):
        for destination in [f"{ORIGIN}/32", "198.18.0.0/15", f"{DNS_ENDPOINT}/32"]:
            run([*self.prefix, IP, "route", "replace", destination, "dev", TUN])

    def stop_client(self, crash=False):
        if self.client is None:
            return
        pid = self.client.pid
        if crash and self.client.poll() is None:
            self.client.kill()  # Exact owned process, never a process-name sweep.
        stop(self.client)
        self.client = None
        links = json.loads(run([*self.prefix, IP, "-j", "link", "show"]))
        ensure(TUN not in [link["ifname"] for link in links], "TUN remains after owned core exit")
        sockets = run([*self.prefix, "ss", "-Hlntup"])
        ensure(not sockets.strip(), "owned listener remains after core exit")
        ensure(not Path(f"/proc/{pid}").exists(), "core PID not reaped")

    def work(self, action="request", **spec):
        result = command([*self.prefix, "taskset", "-c", "4,5", sys.executable,
                          str(HERE / "workload.py"), action, "--spec", json.dumps(spec)], 45)
        ensure(result["status"] != "TIMEOUT", "worker watchdog expired")
        # FAIL/TIMEOUT request JSON is retained. A process failure without JSON is an error.
        if not result["stdout"].strip():
            self.result.setdefault("worker_errors", []).append(result)
            raise RuntimeError(f"{action} worker failed; see worker_errors")
        value = json.loads(result["stdout"])
        value["worker_exit_code"] = result["exit_code"]
        return value

    def check(self, name, value, ok):
        self.result.setdefault("checks", []).append({"candidate": self.kind, "name": name,
                                                    "status": "PASS" if ok else "FAIL", "evidence": value})
        write(self.output / "results.json", self.result)
        ensure(ok, f"parity check failed: {self.kind}/{name}")

    def parity(self, kind):
        self.start_client(kind, f"parity-{kind}")
        for port in [18080, 18081]:
            value = self.work(port=port)
            self.check(f"TUN-port-{port}", value, value["status"] == "PASS")
        route = json.loads(run([*self.prefix, IP, "-j", "route", "get", ORIGIN]))
        self.check("kernel-route-is-TUN", route, route[0]["dev"] == TUN)
        with ThreadPoolExecutor(max_workers=1) as pool:
            proof = pool.submit(self.work, "load", case="proof")
            time.sleep(.15)
            active = json.loads(self.api("/connections")["body"])
            flows = [{"chains": flow["chains"], "port": flow["metadata"]["destinationPort"]}
                     for flow in active["connections"]]
            samples = proof.result()
        chains = {chain for flow in flows for chain in flow["chains"]}
        self.check("two-live-outbounds", {"flows": flows, "requests": samples},
                   {"reality", "hy2"} <= chains and samples["status"] == "PASS")
        for tcp in [False, True]:
            value = self.work("dns", name="reality.bench.test", tcp=tcp)
            fake = value["addresses"]
            self.check(f"DNS-A-{'TCP' if tcp else 'UDP'}", value,
                       len(fake) == 1 and ipaddress.ip_address(fake[0]) in ipaddress.ip_network("198.18.0.0/15"))
            req = self.work(address=fake[0])
            self.check("fake-IP-to-origin", req, req["status"] == "PASS")
        value = self.work("dns", name="hy2.bench.test", qtype=28)
        self.check("IPv6-no-AAAA", value, not value["addresses"])
        blocked = self.work("dns", name="blocked.bench.test")["addresses"][0]
        value = self.work(address=blocked, timeout=1)
        self.check("domain-reject-precedes-port-allow", value, value["status"] != "PASS")
        for name, spec in [("http-503", {"path": "/failure"}),
                           ("deadline", {"path": "/slow", "timeout": .05}),
                           ("default-reject", {"port": 18082, "timeout": 1})]:
            value = self.work(**spec)
            expected = value["status"] != "PASS"
            if name == "http-503":
                expected = value.get("http_status") == 503 and value["status"] == "FAIL"
            elif name == "deadline":
                expected = value["status"] == "TIMEOUT"
            self.check(name, value, expected)
        # An API status cannot establish reload. Change an observable route and prove it.
        replacement = self.output / f"{self.label}-data" / "reload.json"
        write(replacement, client_config(kind, self.creds, self.identity, "reload"))
        before_index = json.loads(run([*self.prefix, IP, "-j", "link", "show", TUN]))[0]["ifindex"]
        response = self.api("/configs?force=true", "PUT", {"path": str(replacement)})
        value = self.work(port=18082, timeout=1)
        if kind != "mihomo":
            self.check("Clash-PUT-is-no-op", {"api": response, "request": value},
                       response["status"] == 204 and value["status"] != "PASS")
            write(self.config, client_config(kind, self.creds, self.identity, "reload"))
            self.client.send_signal(signal.SIGHUP)
            wait_for(lambda: self.api_ready() and json.loads(run(
                [*self.prefix, IP, "-j", "link", "show"]))[-1].get("ifindex") != before_index)
            self.routes()
            value = self.work(port=18082)
        self.check("real-reload-changes-route", value, value["status"] == "PASS")
        after = json.loads(run([*self.prefix, IP, "-j", "link", "show", TUN]))[0]["ifindex"]
        self.check("reload-interface-evidence", {"before_ifindex": before_index, "after_ifindex": after}, True)
        self.stop_client(crash=True)
        value = self.work(timeout=.2)
        self.check("crash-no-direct-origin-path", value, value["status"] != "PASS")
        for variant in ["wrong-sni", "wrong-ca", "wrong-reality"]:
            self.start_client(kind, f"{kind}-{variant}", variant)
            value = self.work(port=18080 if variant == "wrong-reality" else 18081, timeout=2)
            self.check(variant, value, value["status"] != "PASS")
            control = self.work(port=18081 if variant == "wrong-reality" else 18080)
            self.check(f"{variant}-unaffected-transport", control, control["status"] == "PASS")
            self.stop_client()

    def measurement(self, kind, round_number):
        label = f"round-{round_number}-{kind}"
        self.start_client(kind, label)
        record = {"candidate": kind, "round": round_number, "samples": [], "cases": []}
        self.result.setdefault("rounds", []).append(record)
        for case, port, count in [("cold-reality", 18080, 1), ("cold-hy2", 18081, 1),
                                  ("warm-reality", 18080, 12)]:
            for _ in range(count):
                sample = self.work(port=port)
                record["samples"].append(dict(sample, case=case))
        for case in ["short", "bulk", "mixed"]:
            observations = []
            finished = threading.Event()
            def observe():
                while not finished.is_set():
                    observations.append({"client": usage(self.client.pid), "server": usage(self.server.pid),
                                         "fixture": usage(self.fixture.pid), "ns": time.monotonic_ns()})
                    finished.wait(.05)
            observer = threading.Thread(target=observe)
            observer.start()
            before = {"client": usage(self.client.pid), "server": usage(self.server.pid)}
            try:
                values = self.work("load", case=case)
            finally:
                finished.set()
                observer.join()
            after = {"client": usage(self.client.pid), "server": usage(self.server.pid)}
            record["samples"].extend(dict(value, case=case) for value in values["samples"])
            record["cases"].append({"name": case, "status": values["status"], "before": before,
                                    "after": after, "usage_50ms": observations})
            if case == "mixed":
                bulk = next(s for s in values["samples"] if s["port"] == 18081)
                overlap = sum(bulk["start_ns"] < s["start_ns"] < s["end_ns"] < bulk["end_ns"]
                              for s in values["samples"] if s["port"] == 18080)
                record["cases"][-1]["small_requests_fully_overlapping_bulk"] = overlap
        record["TUN_counters"] = json.loads(run([*self.prefix, IP, "-s", "-j", "link", "show", TUN]))
        record["status"] = "PASS" if all(v["status"] == "PASS" for v in record["samples"]) else "FAIL"
        self.stop_client()
        write(self.output / "results.json", self.result)

    def close(self):
        for process in reversed(self.processes):
            stop(process)


def inner(args):
    ensure(os.getpid() == 1 and os.readlink("/proc/self/ns/net") != args.host_ns,
           "refuse original namespace / non-PID1")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    result = {"run_id": args.output.name, "mode": args.action, "status": "FAIL",
              "gate_passed": False, "binary_sha256": {"mihomo": sha(args.mihomo), "sing_box": sha(args.sing_box)},
              "tool_sha256": {name: sha(HERE / name) for name in ["configs.py", "workload.py", "run.py"]},
              "environment_before": snapshot(), "clock_ticks_per_second": os.sysconf("SC_CLK_TCK")}
    experiment = None
    try:
        experiment = Experiment(args, result)
        if args.action == "parity":
            for kind in KINDS:
                experiment.parity(kind)
            result["gate_passed"] = True
        else:
            for round_number, order in enumerate([KINDS, ["go", "mihomo", "gvisor"], ["gvisor", "go", "mihomo"]], 1):
                for kind in order:
                    experiment.measurement(kind, round_number)
            ensure(all(record["status"] == "PASS" for record in result["rounds"]), "failed samples retained")
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
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["parity", "measure", "api"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mihomo", type=Path)
    parser.add_argument("--sing-box", type=Path)
    parser.add_argument("--parity", type=Path)
    parser.add_argument("--inside", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--host-ns", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.action == "api":
        spec = json.loads(args.output.read_text())
        request = urllib.request.Request(f"http://127.0.0.1:{spec['port']}{spec['path']}",
                  data=json.dumps(spec["body"]).encode() if spec["body"] is not None else None,
                  method=spec["method"], headers={"Authorization": "Bearer " + spec["secret"],
                                                "Content-Type": "application/json"})
        try:
            response = urllib.request.urlopen(request, timeout=2)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            print(json.dumps({"status": response.status, "body": response.read(1048576).decode()}))
        return 0
    ensure(args.mihomo and args.sing_box, "both fixed binaries required")
    ensure(sha(args.mihomo) == MIHOMO_SHA and sha(args.sing_box) == SING_SHA, "binary identity mismatch")
    if args.inside:
        return inner(args)
    if args.action == "measure":
        ensure(args.parity is not None, "successful parity result required")
        gate = json.loads(args.parity.read_text())
        ensure(gate["gate_passed"] and gate["status"] == "PASS", "parity did not pass")
        ensure(gate["tool_sha256"] == {name: sha(HERE / name) for name in gate["tool_sha256"]},
               "tools changed since parity; rerun parity before measurement")
    output = args.output.resolve()
    root = HERE.parents[3]
    for line in subprocess.check_output(["git", "worktree", "list", "--porcelain"], cwd=root, text=True).splitlines():
        if line.startswith("worktree "):
            ensure(not output.is_relative_to(Path(line[9:]).resolve()), "output must be outside worktrees")
    output.mkdir(parents=True, exist_ok=False)
    output.chmod(0o700)
    before = network_snapshot()
    argv = ["sudo", "-n", "timeout", "--signal=TERM", "--kill-after=2s", "240s", "unshare",
            "--net", "--pid", "--mount", "--mount-proc", "--fork", "--kill-child=SIGKILL",
            sys.executable, str(HERE / "run.py"), args.action, "--inside", "--host-ns", before["namespace"],
            "--output", str(output), "--mihomo", str(args.mihomo.resolve()), "--sing-box", str(args.sing_box.resolve())]
    execution = command(argv, timeout=250)
    # Read-only evidence recovery: root owns inner files; recursively chown only this new directory.
    run(["sudo", "-n", "chown", "-R", f"{os.getuid()}:{os.getgid()}", output])
    after = network_snapshot()
    write(output / "execution.json", execution)
    write(output / "host-network.json", {"before": before, "after": after, "unchanged": before == after})
    ensure(before == after, "host network snapshot changed")
    if (output / "results.json").exists():
        result = json.loads((output / "results.json").read_text())
        live = run(["lsns", "-t", "net", "-n", "-o", "NS"])
        gone = all(ns.split("[")[1].rstrip("]") not in live.split() for ns in result.get("namespaces", []))
        write(output / "cleanup.json", {"namespaces_gone": gone, "live_namespace_ids": live.split()})
        ensure(gone, "owned namespaces remain")
        print(json.dumps({key: result[key] for key in ["run_id", "mode", "status", "gate_passed"]}))
        if "error" in result:
            print(result["error"])
    return 0 if execution["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
