#!/usr/bin/env python3
"""Stage A only: isolated capability probe and patched-Mihomo SOCKS baseline.

No production controller, Tono Linux service, external destination or sing-box.
The SOCKS measurements are NOT TUN or Reality/Hy2 measurements.
"""
import argparse
import csv
import fcntl
import hashlib
import http.server
import json
import os
from pathlib import Path
import platform
import select
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.request
import uuid

IP = "/usr/sbin/ip" if Path("/usr/sbin/ip").exists() else "/usr/bin/ip"
TC = "/usr/sbin/tc"
PAYLOAD = b"tono-stage-a-synthetic\n" * 256


def command(argv, timeout=10):
    """One owned process group; timeout never means success, children are reaped."""
    start = time.monotonic_ns()
    process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               start_new_session=True)
    try:
        stdout, stderr = process.communicate(timeout=timeout)
        status = "PASS" if process.returncode == 0 else "FAIL"
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        stdout, stderr = process.communicate()
        status = "TIMEOUT"
    except BaseException:
        os.killpg(process.pid, signal.SIGKILL)
        process.communicate()
        raise
    return {"command": argv, "exit_code": process.returncode, "status": status,
            "elapsed_ms": (time.monotonic_ns() - start) / 1e6,
            "stdout": stdout.decode(errors="replace"),
            "stderr": stderr.decode(errors="replace")}


def stop(process):
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


def check_command(argv):
    result = command(argv)
    if result["status"] != "PASS":
        raise RuntimeError(json.dumps(result))
    return result


def snapshot():
    result = {"uname": platform.uname()._asdict(), "vcpus": os.cpu_count(),
              "proxy_environment": {key: bool(os.environ.get(key)) for key in
                                    ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY",
                                     "http_proxy", "https_proxy", "all_proxy"]}}
    for path in ["/proc/stat", "/proc/meminfo", "/proc/self/cgroup",
                 "/sys/fs/cgroup/amp.slice/amp-workload.slice/cpu.max",
                 "/sys/fs/cgroup/amp.slice/amp-workload.slice/cpu.stat",
                 "/sys/fs/cgroup/amp.slice/amp-workload.slice/memory.max",
                 "/sys/fs/cgroup/amp.slice/amp-workload.slice/memory.current"]:
        if Path(path).exists():
            result[path] = Path(path).read_text()
    return result


def network_snapshot():
    return {"namespace": os.readlink("/proc/self/ns/net"),
            "routes": command([IP, "-j", "route", "show", "table", "all"])["stdout"],
            "links": command([IP, "-j", "link", "show"])["stdout"],
            "dns_sha256": hashlib.sha256(Path("/etc/resolv.conf").read_bytes()).hexdigest()}


def capabilities(run_id, output):
    rows = []

    def test(name, action):
        started = time.monotonic_ns()
        try:
            evidence = action()
            rows.append({"name": name, "status": "PASS", "exit_code": 0,
                         "evidence": evidence})
        except Exception as error:
            rows.append({"name": name, "status": "FAIL", "exit_code": 1,
                         "evidence": repr(error)})
        rows[-1]["elapsed_ms"] = (time.monotonic_ns() - started) / 1e6

    def veth(netem=False):
        a, b = "a" + run_id[-8:], "b" + run_id[-8:]
        created = False
        evidence = []
        try:
            evidence.append(check_command([IP, "link", "add", a, "type", "veth", "peer", "name", b]))
            created = True
            for dev in [a, b]:
                evidence.append(check_command([IP, "link", "set", dev, "up"]))
            if netem:
                evidence.append(check_command([TC, "qdisc", "add", "dev", a, "root", "netem",
                                               "delay", "20ms", "limit", "100"]))
                evidence.append(check_command([TC, "-j", "qdisc", "show", "dev", a]))
                evidence.append(check_command([TC, "qdisc", "del", "dev", a, "root"]))
                evidence.append(check_command([TC, "-j", "qdisc", "show", "dev", a]))
            return evidence
        finally:
            if created:
                check_command([IP, "link", "del", a])

    def tun():
        name = "t" + run_id[-8:]
        fd = os.open("/dev/net/tun", os.O_RDWR | os.O_NONBLOCK)
        try:
            fcntl.ioctl(fd, 0x400454CA, struct.pack("16sH", name.encode(), 0x1001))
            check_command([IP, "addr", "add", "198.18.0.1/30", "dev", name])
            check_command([IP, "link", "set", name, "up"])
            # Actual bidirectional kernel/TUN-fd packet I/O, not just TUNSETIFF.
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
                client.bind(("198.18.0.1", 0))
                client.settimeout(2)

                def exchange():
                    start = time.monotonic_ns()
                    client.sendto(b"tono-tun-probe", ("198.18.0.2", 43210))
                    deadline = time.monotonic() + 2
                    while time.monotonic() < deadline:
                        if not select.select([fd], [], [], max(0, deadline - time.monotonic()))[0]:
                            raise TimeoutError("no matching synthetic UDP packet")
                        packet = os.read(fd, 65536)
                        # Interface-up may first emit IPv6 neighbour discovery.
                        if len(packet) >= 28 and packet[0] == 0x45 and packet[9] == 17:
                            break
                    else:
                        raise TimeoutError("no matching synthetic UDP packet")
                    elapsed = (time.monotonic_ns() - start) / 1e6
                    assert packet[0] == 0x45 and packet[9] == 17, "no matching IPv4/UDP"
                    source, destination, length, _ = struct.unpack("!HHHH", packet[20:28])
                    body = packet[28:20 + length]
                    assert body == b"tono-tun-probe"
                    udp = struct.pack("!HHHH", destination, source, length, 0) + body
                    header = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + len(udp), 1,
                                         0, 64, 17, 0, packet[16:20], packet[12:16])
                    checksum = sum(struct.unpack("!10H", header))
                    while checksum >> 16:
                        checksum = (checksum & 0xffff) + (checksum >> 16)
                    header = header[:10] + struct.pack("!H", ~checksum & 0xffff) + header[12:]
                    os.write(fd, header + udp)
                    assert client.recv(64) == b"tono-tun-probe"
                    return elapsed

                return {"ioctl": "TUNSETIFF IFF_TUN|IFF_NO_PI", "payload_verified": True,
                        "kernel_to_fd_ms": [exchange() for _ in range(3)],
                        "scope": "synthetic kernel/fd echo, not a product stack test"}
        finally:
            os.close(fd)  # Nonpersistent TUN removed automatically.

    def sockets():
        with socket.socket() as server, socket.socket() as client:
            server.settimeout(2)
            client.settimeout(2)
            server.bind(("127.0.0.1", 0))
            server.listen(1)
            client.connect(server.getsockname())
            peer, _ = server.accept()
            with peer:
                peer.settimeout(2)
                client.sendall(b"tono-tcp")
                assert peer.recv(32) == b"tono-tcp"
                peer.sendall(b"ack")
                assert client.recv(32) == b"ack"
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as server, \
                socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
            server.bind(("127.0.0.1", 0))
            server.settimeout(2)
            client.settimeout(2)
            client.sendto(b"tono-udp", server.getsockname())
            message, address = server.recvfrom(32)
            server.sendto(message, address)
            assert client.recv(32) == b"tono-udp"
        return "TCP and UDP payloads verified against owned loopback servers in isolated namespace"

    def capture():
        binary = "/usr/bin/tcpdump"
        if not Path(binary).exists():
            binary = "/usr/sbin/tcpdump"
        # Only synthetic traffic exists in this namespace. No host capture.
        capture_file = output / "probe.pcap"
        with (output / "tcpdump.log").open("w") as log:
            process = subprocess.Popen([binary, "-Z", "root", "-U", "-i", "lo", "-c", "1",
                                        "-w", str(capture_file), "udp port 43211"],
                                       stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    if "listening on" in (output / "tcpdump.log").read_text():
                        break
                    time.sleep(.02)
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
                    sender.sendto(b"tono-capture", ("127.0.0.1", 43211))
                assert process.wait(timeout=3) == 0
                assert capture_file.stat().st_size > 24
                return {"packets": 1, "sha256": hashlib.sha256(capture_file.read_bytes()).hexdigest()}
            finally:
                stop(process)

    test("veth_create_remove", veth)
    test("netem_install_remove", lambda: veth(netem=True))
    test("tun_bidirectional_io", tun)
    test("raw_tcp_udp_local", sockets)
    test("packet_capture", capture)
    rows.append({"name": "external_authorized_tcp_udp", "status": "NOT_TESTED",
                 "exit_code": None, "evidence": "No separately authorized external test endpoint supplied"})
    return {"capabilities": rows, "links_after": check_command([IP, "-j", "link", "show"])}


class SyntheticHTTP(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/slow":
            time.sleep(.3)
        code = 503 if self.path == "/failure" else 200
        self.send_response(code)
        self.send_header("Content-Length", str(len(PAYLOAD)))
        self.end_headers()
        try:
            self.wfile.write(PAYLOAD)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *_):
        pass


def sample(port, socks_port, path="/", timeout=2):
    """curl records TTFB; exit + HTTP status + exact body determine success."""
    result = command(["curl", "--silent", "--show-error", "--max-time", str(timeout),
                      "--max-filesize", str(len(PAYLOAD)), "--noproxy", "",
                      "--socks5-hostname", f"127.0.0.1:{socks_port}",
                      "--write-out", "\n%{json}", f"http://127.0.0.1:{port}{path}"], timeout + 1)
    body, separator, metadata = result.pop("stdout").rpartition("\n")
    try:
        values = json.loads(metadata) if separator else {}
    except json.JSONDecodeError:
        values = {}
    passed = (result["status"] == "PASS" and values.get("http_code") == 200
              and body.encode() == PAYLOAD)
    result.update(status="PASS" if passed else "FAIL", http_code=values.get("http_code"),
                  bytes=values.get("size_download", 0), ttfb_seconds=values.get("time_starttransfer"),
                  transfer_seconds=values.get("time_total"), body_verified=body.encode() == PAYLOAD,
                  timeout=result["exit_code"] == 28)
    return result


def smoke(binary, output, profiles=False):
    version = check_command([str(binary), "-v"])
    if "v1.19.30-tono-gvisor-adaptive.1" not in version["stdout"]:
        raise RuntimeError("not the required baseline version")
    manifest = json.loads((binary.parent / "manifest.json").read_text())
    if manifest.get("status") != "BUILT" or hashlib.sha256(binary.read_bytes()).hexdigest() != manifest["binary_sha256"]:
        raise RuntimeError("binary does not match verified build manifest")
    socks_port, controller_port = 17891, 19091
    config = output / "config.yaml"
    config.write_text(f"""socks-port: {socks_port}
bind-address: 127.0.0.1
allow-lan: false
mode: rule
ipv6: false
log-level: {'debug' if profiles else 'warning'}
external-controller: 127.0.0.1:{controller_port}
secret: stage-a-synthetic-controller
geo-auto-update: false
profile:
  store-selected: false
  store-fake-ip: false
dns:
  enable: false
tun:
  enable: false
rules:
  - MATCH,DIRECT
""")
    syntax = check_command([str(binary), "-t", "-d", str(output), "-f", str(config)])
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), SyntheticHTTP)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    rows = []
    started = time.monotonic_ns()
    with (output / "core.log").open("w") as log:
        process = subprocess.Popen([str(binary), "-d", str(output), "-f", str(config)],
                                   stdout=log, stderr=log, env=dict(os.environ, GOMAXPROCS="2"))
        try:
            controller = None
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("core exited before readiness")
                try:
                    request = urllib.request.Request(f"http://127.0.0.1:{controller_port}/version",
                              headers={"Authorization": "Bearer stage-a-synthetic-controller"})
                    with urllib.request.urlopen(request, timeout=.3) as response:
                        controller = json.load(response)
                    if controller.get("version") == manifest["version"]:
                        break
                except OSError:
                    pass
                time.sleep(.02)
            else:
                raise TimeoutError("controller identity readiness")
            readiness_ms = (time.monotonic_ns() - started) / 1e6
            if profiles:
                for kind in ["heap", "goroutine", "mutex", "block", "profile?seconds=1"]:
                    request = urllib.request.Request(f"http://127.0.0.1:{controller_port}/debug/pprof/{kind}",
                              headers={"Authorization": "Bearer stage-a-synthetic-controller"})
                    with urllib.request.urlopen(request, timeout=3) as response:
                        content = response.read(4 * 1024 * 1024 + 1)
                    assert 0 < len(content) <= 4 * 1024 * 1024
                    (output / (kind.split("?")[0] + ".pprof")).write_bytes(content)
                rows.append({"status": "PASS", "note": "pprof fetched; mutex/block sampling not enabled"})
            else:
                warmup = sample(server.server_port, socks_port)
                rows.append(dict(warmup, round=0, sample=0, phase="warmup"))
                for round_number in range(1, 4):
                    for index in range(5):
                        rows.append(dict(sample(server.server_port, socks_port), round=round_number,
                                         sample=index, phase="measurement"))
                # Negative controls deliberately count as failures, not discarded successes.
                rows.append(dict(sample(server.server_port, socks_port, "/failure"), phase="negative_http"))
                rows.append(dict(sample(server.server_port, socks_port, "/slow", .1), phase="negative_timeout"))
            proc_status = Path(f"/proc/{process.pid}/status").read_text()
            proc_stat = Path(f"/proc/{process.pid}/stat").read_text()
            fd_count = len(list(Path(f"/proc/{process.pid}/fd").iterdir()))
        finally:
            stop(process)
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)
    ports_closed = True
    for port in [socks_port, controller_port, server.server_port]:
        with socket.socket() as probe:
            probe.settimeout(.2)
            ports_closed &= probe.connect_ex(("127.0.0.1", port)) != 0
    if rows and not profiles:
        assert rows[-2]["status"] == "FAIL" and rows[-2]["http_code"] == 503
        assert rows[-1]["status"] == "FAIL" and rows[-1]["timeout"]
    return {"layer": "SOCKS5 -> DIRECT -> synthetic loopback HTTP, NOT TUN/Reality/Hy2",
            "syntax": syntax, "controller": controller, "readiness_ms": readiness_ms,
            "config_sha256": hashlib.sha256(config.read_bytes()).hexdigest(),
            "binary_sha256": manifest["binary_sha256"], "samples": rows,
            "core_status": proc_status, "core_stat": proc_stat, "core_fd_count": fd_count,
            "core_exit_code": process.returncode, "ports_closed": ports_closed}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["preflight", "smoke", "profiles"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--binary", type=Path)
    parser.add_argument("--inside", help=argparse.SUPPRESS)
    parser.add_argument("--run-id", default="ta-" + uuid.uuid4().hex[:12])
    args = parser.parse_args()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    output = args.output.resolve()
    if args.inside:
        if os.getpid() != 1 or os.readlink("/proc/self/ns/net") == args.inside:
            parser.error("refusing to run in the original network namespace")
        check_command([IP, "link", "set", "lo", "up"])
        result = {"run_id": args.run_id, "mode": args.mode, "before": snapshot()}
        try:
            result.update(capabilities(args.run_id, output) if args.mode == "preflight"
                          else smoke(args.binary.resolve(), output, args.mode == "profiles"))
        except (Exception, KeyboardInterrupt) as error:
            result.update(error=repr(error), status="FAIL")
        result["after"] = snapshot()
        (output / "results.json").write_text(json.dumps(result, indent=2) + "\n")
        rows = result.get("samples", result.get("capabilities", []))
        if rows:
            with (output / "samples.csv").open("w") as stream:
                fields = sorted(set().union(*(row.keys() for row in rows)))
                writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
                writer.writeheader()
                writer.writerows(rows)
        print(json.dumps({key: value for key, value in result.items()
                          if key not in ["before", "after", "core_status", "core_stat"]}, indent=2))
        bad = result.get("status") == "FAIL" or result.get("ports_closed") is False
        if args.mode == "smoke":
            bad = bad or any(row["status"] != "PASS" for row in rows if row.get("phase") in ["measurement", "warmup"])
        if args.mode == "preflight":
            bad = bad or any(row["status"] == "FAIL" for row in rows)
        return 1 if bad else 0
    # Outputs may contain pcap/profile/binaries and must remain outside git worktrees.
    root = Path(__file__).resolve().parents[3]
    worktrees = subprocess.check_output(["git", "worktree", "list", "--porcelain"], cwd=root, text=True)
    if any(output.is_relative_to(Path(line[9:]).resolve()) for line in worktrees.splitlines()
           if line.startswith("worktree ")):
        parser.error("output must be outside every Tono worktree")
    output.mkdir(parents=True, exist_ok=False)
    before = network_snapshot()
    # The root-owned watchdog is essential: killing the unprivileged sudo
    # wrapper alone does not necessarily kill its root descendants. It also
    # bounds cleanup after parent interruption to at most 52 seconds.
    argv = ["sudo", "-n", "timeout", "--signal=TERM", "--kill-after=2s", "50s",
            "unshare", "--net", "--pid", "--mount", "--mount-proc",
            "--fork", "--kill-child=SIGKILL",
            sys.executable, str(Path(__file__).resolve()), args.mode,
            "--output", str(output), "--inside", before["namespace"], "--run-id", args.run_id]
    if args.binary:
        argv += ["--binary", str(args.binary.resolve())]
    try:
        execution = command(argv, timeout=60)
    finally:
        after = network_snapshot()
        (output / "host-network.json").write_text(json.dumps(
            {"before": before, "after": after, "unchanged": before == after}, indent=2) + "\n")
    (output / "execution.json").write_text(json.dumps(execution, indent=2) + "\n")
    print(execution["stdout"])
    print(execution["stderr"], file=sys.stderr)
    print(f"outer_status={execution['status']} exit={execution['exit_code']} host_network_unchanged={before == after}")
    return 0 if execution["status"] == "PASS" and before == after else 1


if __name__ == "__main__":
    sys.exit(main())
