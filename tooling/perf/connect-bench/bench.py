#!/usr/bin/env python3
"""Local connect bench: Tono's mihomo config vs a strict Clash config.

Loopback only. TUN, PF, WFP, system DNS and the host route table are not
touched. A short delay on the Reality camouflage accept makes each proxy
handshake visible; the same delay is applied to every profile.

Pinned cores:
  mihomo v1.19.30 (the client under test, stock build, not the Tono patch)
  sing-box 1.14.2 (local protocol servers)
  sing-box 1.15.0-alpha.9 (third client, stock upstream tarball, same
  revision the certified build names; not the Tono-signed binary)

Tono's owned runtime admits only VLESS+Reality and Hysteria2. Trojan, VMess,
Shadowsocks and TUIC are measured on the Clash profile and reported as
not admitted for Tono.

Usage:
  python3 tooling/perf/connect-bench/bench.py
  python3 tooling/perf/connect-bench/bench.py --check
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import socket
import ssl
import statistics
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CACHE = Path(__file__).resolve().parent / ".cache"
BASELINE = Path(__file__).resolve().parent / "baseline.json"
MIHOMO_URL = "https://github.com/MetaCubeX/mihomo/releases/download/v1.19.30/mihomo-linux-amd64-v1.19.30.gz"
MIHOMO_SHA = "cf06ce2c7d1421bdbda14ee4a5b6046672dc35ebf8eecd8e77504ec3c0ed9a84"
SINGBOX_URL = "https://github.com/SagerNet/sing-box/releases/download/v1.14.2/sing-box-1.14.2-linux-amd64.tar.gz"
SINGBOX_SHA = "a684484d7477d1437282ee411f4d131d0340aaad60a7868841ebd5d87dd8a0c6"
SINGBOX_CLIENT_URL = "https://github.com/SagerNet/sing-box/releases/download/v1.15.0-alpha.9/sing-box-1.15.0-alpha.9-linux-amd64.tar.gz"
SINGBOX_CLIENT_SHA = "8aede1f5935a856d939c61413677dc2e7e3eb0046efbc22b9a869229e6da279f"
UUID = "9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d"
SHORT_ID = "0123456789abcdef"
ORIGIN_HOST = "bench.tono.test"
OTHER_HOST = "other.tono.test"
OTHER_HOST_2 = "other2.tono.test"
CAMO_DELAY_S = 0.04
SAMPLES = 5


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, dest: Path, expected: str) -> None:
    if dest.exists() and sha256_file(dest) == expected:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    urllib.request.urlretrieve(url, tmp)
    got = sha256_file(tmp)
    if got != expected:
        tmp.unlink(missing_ok=True)
        raise SystemExit(f"checksum mismatch for {url}: {got}")
    tmp.replace(dest)


def ensure_bins() -> tuple[Path, Path]:
    download(MIHOMO_URL, CACHE / "mihomo.gz", MIHOMO_SHA)
    download(SINGBOX_URL, CACHE / "sing-box.tar.gz", SINGBOX_SHA)
    mihomo = CACHE / "mihomo"
    sing = CACHE / "sing-box"
    if not mihomo.exists():
        subprocess.run(["gzip", "-dc", str(CACHE / "mihomo.gz")], check=True, stdout=mihomo.open("wb"))
        mihomo.chmod(0o755)
    if not sing.exists():
        subprocess.run(["tar", "-xzf", str(CACHE / "sing-box.tar.gz"), "-C", str(CACHE)], check=True)
        unpacked = CACHE / "sing-box-1.14.2-linux-amd64" / "sing-box"
        shutil.copy(unpacked, sing)
        sing.chmod(0o755)
    return mihomo, sing


def ensure_singbox_client() -> Path:
    archive = CACHE / "sing-box-1.15.0-alpha.9.tar.gz"
    download(SINGBOX_CLIENT_URL, archive, SINGBOX_CLIENT_SHA)
    dest = CACHE / "sing-box-1.15.0-alpha.9"
    if not dest.exists():
        subprocess.run(["tar", "-xzf", str(archive), "-C", str(CACHE)], check=True)
        unpacked = CACHE / "sing-box-1.15.0-alpha.9-linux-amd64" / "sing-box"
        shutil.copy(unpacked, dest)
        dest.chmod(0o755)
    return dest


def dns_reply(query: bytes) -> bytes:
    if len(query) < 12:
        raise ValueError("short dns query")
    index = 12
    while index < len(query) and query[index] != 0:
        index += 1 + query[index]
    index += 1
    qtype = int.from_bytes(query[index : index + 2], "big") if index + 2 <= len(query) else 1
    end = index + 4
    question = query[12:end]
    tid = query[:2]
    if qtype == 28:
        return tid + b"\x81\x80" + b"\x00\x01\x00\x00\x00\x00\x00\x00" + question
    answer = b"\xc0\x0c" + (1).to_bytes(2, "big") + b"\x00\x01" + (30).to_bytes(4, "big") + (4).to_bytes(2, "big") + bytes([127, 0, 0, 2])
    return tid + b"\x81\x80" + b"\x00\x01\x00\x01\x00\x00\x00\x00" + question + answer


class Origin(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self):  # noqa: N802
        body = b"ok"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


class Doh(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _answer(self, body: bytes) -> None:
        out = dns_reply(body)
        self.send_response(200)
        self.send_header("Content-Type", "application/dns-message")
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def do_POST(self):  # noqa: N802
        size = int(self.headers.get("Content-Length", "0"))
        self._answer(self.rfile.read(size))

    def do_GET(self):  # noqa: N802
        raw = ""
        if "?" in self.path:
            for part in self.path.split("?", 1)[1].split("&"):
                if part.startswith("dns="):
                    raw = part[4:]
        padded = raw + "=" * (-len(raw) % 4)
        try:
            body = base64.urlsafe_b64decode(padded)
        except Exception:
            body = b""
        self._answer(body)

    def log_message(self, *_args):
        return


class Camo:
    def __init__(self, cert: Path, key: Path) -> None:
        self.handshakes = 0
        self.marks: list[tuple[float, float]] = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(cert, key)
        sock = socket.socket()
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", 18444))
        sock.listen(64)
        sock.settimeout(0.2)
        self._sock = sock
        self._ctx = ctx
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def reset(self) -> int:
        with self._lock:
            count = self.handshakes
            self.handshakes = 0
            self.marks = []
            return count

    def snapshot(self) -> list[tuple[float, float]]:
        with self._lock:
            return list(self.marks)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                raw, _addr = self._sock.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            accepted = time.perf_counter()
            time.sleep(CAMO_DELAY_S)
            try:
                tls = self._ctx.wrap_socket(raw, server_side=True)
                tls.recv(8)
                tls.close()
            except Exception:
                try:
                    raw.close()
                except Exception:
                    pass
            finished = time.perf_counter()
            with self._lock:
                self.handshakes += 1
                self.marks.append((accepted, finished))

    def close(self) -> None:
        self._stop.set()
        self._sock.close()


def udp_dns() -> None:
    # Linux reports ICMP port-unreachable on the next UDP recv, including for a
    # reply we already sent to a client that has closed. An uncaught OSError
    # ends this thread and unbinds 15353; the next /dns/query is then a ~1ms
    # "connection refused" and the sample median becomes None.
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(0.5)
    sock.bind(("127.0.0.2", 15353))
    while True:
        try:
            data, addr = sock.recvfrom(2048)
        except socket.timeout:
            continue
        except OSError:
            time.sleep(0.001)
            continue
        try:
            reply = dns_reply(data)
        except Exception:
            continue
        try:
            sock.sendto(reply, addr)
        except OSError:
            continue


def wait_port(port: int, timeout: float = 3) -> None:
    deadline = time.perf_counter() + timeout
    while time.perf_counter() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), 0.2):
                return
        except OSError:
            time.sleep(0.02)
    raise SystemExit(f"port {port} did not open")


def encode_qname(name: str) -> bytes:
    return b"".join(bytes([len(label)]) + label.encode() for label in name.split(".")) + b"\x00"


def parse_a(packet: bytes) -> list[str]:
    if len(packet) < 12:
        return []
    questions = int.from_bytes(packet[4:6], "big")
    answers = int.from_bytes(packet[6:8], "big")
    index = 12
    for _ in range(questions):
        while index < len(packet) and packet[index] != 0:
            index += 1 + packet[index]
        index += 5
    found = []
    for _ in range(answers):
        if index >= len(packet):
            break
        if packet[index] & 0xC0 == 0xC0:
            index += 2
        else:
            while index < len(packet) and packet[index] != 0:
                index += 1 + packet[index]
            index += 1
        if index + 10 > len(packet):
            break
        rtype = int.from_bytes(packet[index:index + 2], "big")
        rdlen = int.from_bytes(packet[index + 8:index + 10], "big")
        rdata = packet[index + 10:index + 10 + rdlen]
        if rtype == 1 and len(rdata) == 4:
            found.append(".".join(str(byte) for byte in rdata))
        index += 10 + rdlen
    return found


# A miss faster than this is a refused or empty read, not the lookup itself.
# Slower misses are final so a timeout is not retried into a passing sample.
FAST_DNS_MISS_MS = 100
DNS_MISS_BUDGET_S = 1.0


def dns_query_once(controller: int, name: str) -> tuple[bool, float, str]:
    """Real resolve through `/dns/query`. This is not the fake-ip listener."""
    quoted = urllib.parse.quote(name)
    url = f"http://127.0.0.1:{controller}/dns/query?name={quoted}&type=A"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer bench"})
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            body = resp.read()
            ok = resp.status == 200 and b"127.0.0.2" in body
            detail = "" if ok else f"status {resp.status}"
    except Exception as exc:
        detail = str(exc)
        if hasattr(exc, "read"):
            try:
                detail = exc.read().decode("utf-8", "replace")[:180]
            except Exception:
                pass
        return False, (time.perf_counter() - started) * 1000, detail
    return ok, (time.perf_counter() - started) * 1000, detail


def accept_dns_sample(pull, now, sleep) -> tuple[bool, float]:
    """Score one DNS sample.

    `pull` returns `(ok, elapsed_ms)` for a single round trip. A fast miss is
    retried until `DNS_MISS_BUDGET_S`. The number kept on success is that
    attempt's own elapsed time, so a 0.8ms answer stays 0.8ms. A miss that
    already took >= FAST_DNS_MISS_MS is final. Never-recovered misses stay
    failures (`ok` false); callers must not treat that as a passing median.
    """
    deadline = now() + DNS_MISS_BUDGET_S
    elapsed = 0.0
    while True:
        ok, elapsed = pull()
        if ok:
            return True, elapsed
        if elapsed >= FAST_DNS_MISS_MS or now() >= deadline:
            return False, elapsed
        sleep(0.02)


def exceeds_limit(got: float | None, limit: float) -> bool:
    return got is None or got > limit


def _assert_dns_sample_policy() -> None:
    clock = {"t": 0.0}

    def now() -> float:
        return clock["t"]

    def sleep(seconds: float) -> None:
        clock["t"] += seconds

    def scripted(pairs):
        seq = iter(pairs)

        def pull():
            return next(seq)

        return pull

    ok, elapsed = accept_dns_sample(scripted([(False, 0.4), (True, 0.8)]), now, sleep)
    if not ok or elapsed != 0.8:
        raise SystemExit("dns sample policy dropped a recovered answer")
    clock["t"] = 0.0
    ok, elapsed = accept_dns_sample(scripted([(True, 250.0)]), now, sleep)
    if not ok or elapsed != 250.0:
        raise SystemExit("dns sample policy hid a slow answer")
    clock["t"] = 0.0
    ok, _elapsed = accept_dns_sample(scripted([(False, 0.5)] * 80), now, sleep)
    if ok:
        raise SystemExit("dns sample policy treated a miss as success")
    clock["t"] = 0.0
    ok, _elapsed = accept_dns_sample(scripted([(False, 150.0), (True, 0.8)]), now, sleep)
    if ok:
        raise SystemExit("dns sample policy retried a slow miss")
    if not exceeds_limit(None, 30) or exceeds_limit(0.8, 30) or exceeds_limit(30, 30):
        raise SystemExit("dns ceiling treats a miss as success or moves the limit")


def dns_query(controller: int, name: str) -> tuple[bool, float]:
    detail = {"text": ""}

    def pull():
        ok, elapsed, text = dns_query_once(controller, name)
        detail["text"] = text
        return ok, elapsed

    ok, elapsed = accept_dns_sample(pull, time.perf_counter, time.sleep)
    if not ok:
        print(f"dns miss {controller} {elapsed:.1f}ms {detail['text']}", file=sys.stderr)
    return ok, elapsed


def fake_ip_exchange(port: int, timeout: float, name: str = ORIGIN_HOST) -> tuple[bool, float]:
    """One UDP query to the core DNS listener. A fake-ip answer must not dial the exit."""
    query_id = os.urandom(2)
    query = query_id + b"\x01\x00\x00\x01\x00\x00\x00\x00\x00\x00" + encode_qname(name) + b"\x00\x01\x00\x01"
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    started = time.perf_counter()
    try:
        sock.sendto(query, ("127.0.0.1", port))
        data, _addr = sock.recvfrom(2048)
    except Exception:
        return False, (time.perf_counter() - started) * 1000
    finally:
        sock.close()
    elapsed = (time.perf_counter() - started) * 1000
    if len(data) < 2 or data[:2] != query_id:
        return False, elapsed
    return any(ip.startswith("198.18.") for ip in parse_a(data)), elapsed


def wait_fake_ip(port: int, deadline_s: float = 2.0) -> bool:
    """Retransmit until the listener answers. This is not the timed sample.

    `/version` can succeed before the UDP listener binds. A datagram sent in
    that window is dropped and never retransmitted. Hysteria2 and TUIC lose
    the race; VLESS usually does not. Folding the wait into the sample would
    blow the 15 ms local-answer ceiling.
    """
    deadline = time.perf_counter() + deadline_s
    while time.perf_counter() < deadline:
        remaining = deadline - time.perf_counter()
        ok, _elapsed = fake_ip_exchange(port, timeout=min(0.25, max(remaining, 0.05)))
        if ok:
            return True
    return False


def fake_ip_query(port: int, name: str = ORIGIN_HOST) -> tuple[bool, float]:
    """Timed fake-ip query. Call wait_fake_ip first so a lost datagram is not the sample."""
    return fake_ip_exchange(port, timeout=1.0, name=name)


def curl(proxy: int, url: str) -> tuple[int, float]:
    proc = subprocess.run(
        [
            "curl", "-s", "-o", "/dev/null", "-m", "4",
            "-x", f"http://127.0.0.1:{proxy}",
            "-w", "%{http_code} %{time_starttransfer}",
            url,
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    parts = (proc.stdout or "0 0").split()
    code = int(parts[0]) if parts and parts[0].isdigit() else 0
    elapsed = float(parts[1]) if len(parts) > 1 else 0.0
    return code, elapsed * 1000


def controller_ready(port: int) -> bool:
    try:
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}/version",
            headers={"Authorization": "Bearer bench"},
        )
        with urllib.request.urlopen(req, timeout=0.4) as resp:
            return resp.status == 200
    except Exception:
        return False


class Core:
    def __init__(self, mihomo: Path, work: Path, config: Path, mixed: int, controller: int) -> None:
        env = os.environ.copy()
        env["SSL_CERT_FILE"] = str(work / "ca-bundle.pem")
        (work / f"core-{mixed}").mkdir(parents=True, exist_ok=True)
        self.proc = subprocess.Popen(
            [str(mihomo), "-d", str(work / f"core-{mixed}"), "-f", str(config)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
        )
        self.mixed = mixed
        self.controller = controller
        deadline = time.perf_counter() + 5
        while time.perf_counter() < deadline:
            if controller_ready(controller):
                return
            if self.proc.poll() is not None:
                raise SystemExit(f"mihomo exited for {config}")
            time.sleep(0.02)
        raise SystemExit(f"mihomo controller {controller} did not answer")

    def close(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def yaml_for(profile: str, protocol: str, material: dict, mixed: int, controller: int) -> str:
    started = time.perf_counter()
    fingerprint = ""
    if profile != "tono":
        fingerprint = "    client-fingerprint: chrome\n"
    tcp = "tcp-concurrent: true\n" if profile != "tono" else ""
    process = "always" if profile == "tono" or profile == "tono-fixed" else "off"
    if profile == "clash":
        process = "off"
    unified = "true" if profile != "clash" else "false"
    dns_ipv6 = "" if profile == "tono" else "  ipv6: false\n"
    if profile == "clash":
        nameserver = "    - 127.0.0.2:15353\n"
        proxy_ns = "    - 127.0.0.2:15353\n"
        respect = ""
    else:
        nameserver = "    - https://127.0.0.2:18443/dns-query#Tono-Exit\n"
        proxy_ns = "    - https://127.0.0.2:18443/dns-query#Tono-Exit\n"
        respect = "  respect-rules: true\n  use-hosts: true\n"
    pub = material["public"]
    fp = material["fingerprint"]
    if protocol == "vless":
        proxy = f"""  - name: bench
    type: vless
    server: 127.0.0.1
    port: 24431
    uuid: {UUID}
    udp: true
    tls: true
    flow: xtls-rprx-vision
    servername: www.microsoft.com
{fingerprint}    network: tcp
    reality-opts:
      public-key: "{pub}"
      short-id: "{SHORT_ID}"
"""
    elif protocol == "hysteria2":
        proxy = f"""  - name: bench
    type: hysteria2
    server: 127.0.0.1
    port: 24432
    password: "{UUID}"
    sni: bench.local
    fingerprint: "{fp}"
"""
    elif protocol == "trojan":
        # Trojan's fingerprint field is a uTLS name. The leaf is checked
        # against SSL_CERT_FILE; the pin stays off skip-cert-verify.
        proxy = f"""  - name: bench
    type: trojan
    server: 127.0.0.1
    port: 24433
    password: "bench-pass"
    sni: bench.local
    client-fingerprint: chrome
"""
    elif protocol == "vmess":
        proxy = f"""  - name: bench
    type: vmess
    server: 127.0.0.1
    port: 24434
    uuid: {UUID}
    alterId: 0
    cipher: auto
"""
    elif protocol == "ss":
        proxy = f"""  - name: bench
    type: ss
    server: 127.0.0.1
    port: 24435
    cipher: aes-256-gcm
    password: "bench-pass"
"""
    elif protocol == "tuic":
        proxy = f"""  - name: bench
    type: tuic
    server: 127.0.0.1
    port: 24436
    uuid: {UUID}
    password: "bench-pass"
    sni: bench.local
    fingerprint: "{fp}"
    alpn:
      - h3
    udp-relay-mode: native
"""
    else:
        raise SystemExit(protocol)
    text = f"""mixed-port: {mixed}
bind-address: 127.0.0.1
allow-lan: false
ipv6: false
mode: rule
log-level: warning
udp: true
unified-delay: {unified}
{tcp}find-process-mode: {process}
external-controller: 127.0.0.1:{controller}
secret: bench
profile:
  store-selected: false
dns:
  enable: true
  listen: 127.0.0.1:{controller + 1000}
{dns_ipv6}  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  fake-ip-ttl: 30
  prefer-h3: false
  cache-algorithm: lru
{respect}  nameserver:
{nameserver}  proxy-server-nameserver:
{proxy_ns}proxies:
{proxy}proxy-groups:
  - name: Tono-Exit
    type: select
    proxies: ["bench"]
rules:
  - MATCH,Tono-Exit
"""
    if "skip-cert-verify" in text or "handshake-timeout" in text:
        raise SystemExit("bench config weakened TLS")
    material["last_yaml_ms"] = (time.perf_counter() - started) * 1000
    return text


def _median(values: list) -> float | None:
    nums = [v for v in values if v is not None]
    if len(nums) != len(values) or not nums:
        return None
    return round(statistics.median(nums), 1)


def _count(values: list) -> float | None:
    if len(values) != SAMPLES:
        return None
    return round(statistics.median(values), 1)


def measure(mihomo: Path, work: Path, camo: Camo, profile: str, protocol: str, material: dict, slot: int) -> dict:
    mixed = 30000 + slot
    controller = 31000 + slot
    config = work / f"{profile}-{protocol}.yaml"
    config.write_text(yaml_for(profile, protocol, material, mixed, controller))
    cold, warm, starts, handshakes = [], [], [], []
    dns_ms, dns_handshakes, handshake_ms = [], [], []
    fake_ip_ms, fake_ip_handshakes = [], []
    dns_cached_ms, dns_cached_handshakes = [], []
    dns_reuse_ms, dns_reuse_handshakes = [], []
    listen = controller + 1000
    for _ in range(SAMPLES):
        t0 = time.perf_counter()
        core = Core(mihomo, work, config, mixed, controller)
        starts.append((time.perf_counter() - t0) * 1000)
        # Fake-ip is local. It must not open a proxy handshake, and it must
        # finish before the first request so DoH is off the first-byte path.
        # Readiness retransmits until the UDP listener answers; the timed
        # query starts only after that, with the camouflage counter cleared.
        wait_fake_ip(listen)
        camo.reset()
        fake_ok, fake_elapsed = fake_ip_query(listen)
        if fake_ok:
            fake_ip_ms.append(fake_elapsed)
            fake_ip_handshakes.append(len(camo.snapshot()))
        camo.reset()
        code, elapsed = curl(mixed, f"http://{ORIGIN_HOST}:18080/")
        marks = camo.snapshot()
        cold.append(elapsed if code == 200 else None)
        handshakes.append(len(marks))
        if code == 200 and marks:
            handshake_ms.append((marks[-1][1] - marks[-1][0]) * 1000)
        code2, elapsed2 = curl(mixed, f"http://{ORIGIN_HOST}:18080/")
        warm.append(elapsed2 if code2 == 200 else None)
        # Cold `/dns/query` is a real DoH resolve through the exit. It is the
        # pre-warm, not the first byte. A miss here leaves the request above.
        camo.reset()
        dns_ok, dns_elapsed = dns_query(controller, ORIGIN_HOST)
        if dns_ok:
            dns_ms.append(dns_elapsed)
            dns_handshakes.append(len(camo.snapshot()))
        camo.reset()
        cached_ok, cached_elapsed = dns_query(controller, ORIGIN_HOST)
        if cached_ok:
            dns_cached_ms.append(cached_elapsed)
            dns_cached_handshakes.append(len(camo.snapshot()))
        # A different name misses the message cache and reuses the HTTP/2
        # client. It must not open another Reality handshake. The remaining
        # time is one tunnel round trip; the camouflage delay inflates that
        # RTT, so the handshake count is the reuse signal.
        camo.reset()
        dns_query(controller, OTHER_HOST)
        camo.reset()
        reuse_ok, reuse_elapsed = dns_query(controller, OTHER_HOST_2)
        if reuse_ok:
            dns_reuse_ms.append(reuse_elapsed)
            dns_reuse_handshakes.append(len(camo.snapshot()))
        core.close()

    return {
        "profile": profile,
        "protocol": protocol,
        "config_ms": round(material["last_yaml_ms"], 3),
        "startup_ms": _median(starts),
        "cold_ms": _median(cold),
        "warm_ms": _median(warm),
        "fake_ip_ms": _median(fake_ip_ms) if len(fake_ip_ms) == SAMPLES else None,
        "fake_ip_handshakes": _count(fake_ip_handshakes),
        "dns_ms": _median(dns_ms) if len(dns_ms) == SAMPLES else None,
        "dns_handshakes": _count(dns_handshakes),
        "dns_cached_ms": _median(dns_cached_ms) if len(dns_cached_ms) == SAMPLES else None,
        "dns_cached_handshakes": _count(dns_cached_handshakes),
        "dns_reuse_ms": _median(dns_reuse_ms) if len(dns_reuse_ms) == SAMPLES else None,
        "dns_reuse_handshakes": _count(dns_reuse_handshakes),
        "handshake_ms": _median(handshake_ms) if len(handshake_ms) == SAMPLES else None,
        "handshakes": _count(handshakes),
        "ok": _median(cold) is not None,
    }


def contention(mihomo: Path, work: Path, camo: Camo, material: dict) -> dict | None:
    """`/delay` (unified-delay doubles it) beside the first request.

    Connect used to start this probe before the data-plane check. The probe is
    not required for success, but it opens extra Reality handshakes on the same
    exit while the real request is in flight.
    """
    config = work / "contention.yaml"
    config.write_text(yaml_for("tono-fixed", "vless", material, 32001, 32002))
    core = Core(mihomo, work, config, 32001, 32002)

    def delay():
        url = "http://127.0.0.1:32002/proxies/Tono-Exit/delay?timeout=3000&url=http%3A%2F%2Fbench.tono.test%3A18080%2F"
        req = urllib.request.Request(url, headers={"Authorization": "Bearer bench"})
        try:
            urllib.request.urlopen(req, timeout=4).read()
        except Exception:
            return

    camo.reset()
    thread = threading.Thread(target=delay)
    thread.start()
    time.sleep(0.01)
    code, elapsed = curl(32001, f"http://{ORIGIN_HOST}:18080/")
    thread.join(timeout=4)
    handshakes = len(camo.snapshot())
    core.close()
    if code != 200:
        return None
    return {"cold_ms": round(elapsed, 1), "handshakes": handshakes}


def server_config(work: Path, material: dict) -> dict:
    cert = str(work / "cert.pem")
    key = str(work / "key.pem")
    tls = {"enabled": True, "certificate_path": cert, "key_path": key}
    return {
        "log": {"level": "error"},
        "inbounds": [
            {
                "type": "vless", "tag": "vless", "listen": "127.0.0.1", "listen_port": 24431,
                "users": [{"uuid": UUID, "flow": "xtls-rprx-vision"}],
                "tls": {
                    "enabled": True, "server_name": "www.microsoft.com",
                    "reality": {
                        "enabled": True,
                        "handshake": {"server": "127.0.0.1", "server_port": 18444},
                        "private_key": material["private"],
                        "short_id": [SHORT_ID],
                    },
                },
            },
            {"type": "hysteria2", "tag": "hy2", "listen": "127.0.0.1", "listen_port": 24432,
             "users": [{"password": UUID}], "tls": tls},
            {"type": "trojan", "tag": "trojan", "listen": "127.0.0.1", "listen_port": 24433,
             "users": [{"password": "bench-pass"}], "tls": tls},
            {"type": "vmess", "tag": "vmess", "listen": "127.0.0.1", "listen_port": 24434,
             "users": [{"uuid": UUID, "alterId": 0}]},
            {"type": "shadowsocks", "tag": "ss", "listen": "127.0.0.1", "listen_port": 24435,
             "method": "aes-256-gcm", "password": "bench-pass"},
            {"type": "tuic", "tag": "tuic", "listen": "127.0.0.1", "listen_port": 24436,
             "users": [{"uuid": UUID, "password": "bench-pass"}],
             "tls": {**tls, "alpn": ["h3"]}},
        ],
        "outbounds": [{"type": "direct", "tag": "direct"}],
    }


def filter_servers(sing: Path, work: Path, material: dict) -> list[str]:
    full = server_config(work, material)
    kept = []
    for inbound in full["inbounds"]:
        trial = {"log": full["log"], "inbounds": [inbound], "outbounds": full["outbounds"]}
        path = work / f"check-{inbound['tag']}.json"
        path.write_text(json.dumps(trial))
        result = subprocess.run([str(sing), "check", "-c", str(path)], capture_output=True, text=True)
        if result.returncode == 0:
            kept.append(inbound)
        else:
            print(f"skip server {inbound['tag']}: {(result.stderr or result.stdout).strip()}", file=sys.stderr)
    # The exit resolves the name the client sent. Production exits use public
    # DNS; this pin is only so loopback does not NXDOMAIN the bench host.
    path = work / "server.json"
    path.write_text(json.dumps({
        "log": {"level": "error"},
        "dns": {
            "servers": [{
                "type": "hosts",
                "tag": "hosts",
                "predefined": {ORIGIN_HOST: ["127.0.0.2"]},
            }],
            "final": "hosts",
        },
        "inbounds": kept,
        "outbounds": [{
            "type": "direct",
            "tag": "direct",
            "domain_resolver": {"server": "hosts", "strategy": "ipv4_only"},
        }],
    }))
    return [item["tag"] for item in kept]


def singbox_config(protocol: str, material: dict, mixed: int, controller: int, dns_port: int, work: Path) -> dict:
    """Stock alpha.9 client. Same shape as the owned emitter: chrome uTLS,
    fake-ip for the dial, DoH only for a real lookup, no QUIC DNS.
    """
    started = time.perf_counter()
    cert = str(work / "cert.pem")
    if protocol == "vless":
        outbound = {
            "type": "vless",
            "tag": "proxy",
            "server": "127.0.0.1",
            "server_port": 24431,
            "uuid": UUID,
            "flow": "xtls-rprx-vision",
            "tls": {
                "enabled": True,
                "server_name": "www.microsoft.com",
                "utls": {"enabled": True, "fingerprint": "chrome"},
                "reality": {
                    "enabled": True,
                    "public_key": material["public"],
                    "short_id": SHORT_ID,
                },
            },
        }
    elif protocol == "hysteria2":
        outbound = {
            "type": "hysteria2",
            "tag": "proxy",
            "server": "127.0.0.1",
            "server_port": 24432,
            "password": UUID,
            "tls": {
                "enabled": True,
                "server_name": "bench.local",
                "certificate_path": cert,
            },
        }
    else:
        raise SystemExit(protocol)
    config = {
        "log": {"level": "error"},
        "dns": {
            "servers": [
                {"type": "fakeip", "tag": "fakeip", "inet4_range": "198.18.0.1/16"},
                {
                    "type": "https",
                    "tag": "doh",
                    "server": "127.0.0.2",
                    "server_port": 18443,
                    "path": "/dns-query",
                    "tls": {
                        "enabled": True,
                        "server_name": "127.0.0.2",
                        "certificate_path": cert,
                    },
                    "detour": "proxy",
                },
            ],
            "rules": [
                {"query_type": ["AAAA"], "action": "predefined", "rcode": "NOERROR"},
                {
                    "domain": [ORIGIN_HOST],
                    "query_type": ["A"],
                    "action": "route",
                    "server": "fakeip",
                },
            ],
            "final": "doh",
            "strategy": "ipv4_only",
        },
        "inbounds": [
            {"type": "mixed", "tag": "mixed", "listen": "127.0.0.1", "listen_port": mixed},
            {"type": "direct", "tag": "dns-in", "listen": "127.0.0.1", "listen_port": dns_port},
        ],
        "outbounds": [outbound],
        "route": {
            "rules": [{"inbound": ["dns-in"], "action": "hijack-dns"}],
            "final": "proxy",
        },
        "experimental": {
            "clash_api": {
                "external_controller": f"127.0.0.1:{controller}",
                "secret": "bench",
            }
        },
    }
    blob = json.dumps(config)
    if "skip-cert-verify" in blob or '"insecure": true' in blob or "handshake-timeout" in blob:
        raise SystemExit("bench config weakened TLS")
    material["last_yaml_ms"] = (time.perf_counter() - started) * 1000
    return config


class SingBox:
    def __init__(self, binary: Path, work: Path, config: dict, mixed: int, controller: int) -> None:
        path = work / f"singbox-{mixed}.json"
        path.write_text(json.dumps(config))
        directory = work / f"sb-core-{mixed}"
        directory.mkdir(parents=True, exist_ok=True)
        log_path = work / f"singbox-{mixed}.log"
        self._log = log_path.open("w")
        self.proc = subprocess.Popen(
            [str(binary), "run", "-c", str(path), "-D", str(directory)],
            stdout=self._log,
            stderr=subprocess.STDOUT,
        )
        self.mixed = mixed
        self.controller = controller
        deadline = time.perf_counter() + 5
        while time.perf_counter() < deadline:
            if controller_ready(controller):
                return
            if self.proc.poll() is not None:
                self._log.flush()
                tail = log_path.read_text(errors="replace")[-400:]
                raise SystemExit(f"sing-box exited for {path}: {tail}")
            time.sleep(0.02)
        raise SystemExit(f"sing-box controller {controller} did not answer")

    def close(self) -> None:
        self.proc.terminate()
        try:
            self.proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        self._log.close()


def measure_singbox(binary: Path, work: Path, camo: Camo, protocol: str, material: dict, slot: int) -> dict:
    mixed = 30000 + slot
    controller = 31000 + slot
    listen = controller + 1000
    config = singbox_config(protocol, material, mixed, controller, listen, work)
    cold, warm, starts, handshakes = [], [], [], []
    dns_ms, dns_handshakes, handshake_ms = [], [], []
    fake_ip_ms, fake_ip_handshakes = [], []
    dns_cached_ms, dns_cached_handshakes = [], []
    dns_reuse_ms, dns_reuse_handshakes = [], []
    for _ in range(SAMPLES):
        t0 = time.perf_counter()
        core = SingBox(binary, work, config, mixed, controller)
        starts.append((time.perf_counter() - t0) * 1000)
        wait_fake_ip(listen)
        camo.reset()
        fake_ok, fake_elapsed = fake_ip_query(listen)
        if fake_ok:
            fake_ip_ms.append(fake_elapsed)
            fake_ip_handshakes.append(len(camo.snapshot()))
        camo.reset()
        code, elapsed = curl(mixed, f"http://{ORIGIN_HOST}:18080/")
        marks = camo.snapshot()
        cold.append(elapsed if code == 200 else None)
        handshakes.append(len(marks))
        if code == 200 and marks:
            handshake_ms.append((marks[-1][1] - marks[-1][0]) * 1000)
        code2, elapsed2 = curl(mixed, f"http://{ORIGIN_HOST}:18080/")
        warm.append(elapsed2 if code2 == 200 else None)
        # The dial name is pinned to fake-ip, so a real resolve has to ask for
        # a different name. Clash API /dns/query is that path. A miss here
        # does not undo the request above.
        camo.reset()
        dns_ok, dns_elapsed = dns_query(controller, OTHER_HOST)
        if dns_ok:
            dns_ms.append(dns_elapsed)
            dns_handshakes.append(len(camo.snapshot()))
        camo.reset()
        cached_ok, cached_elapsed = dns_query(controller, OTHER_HOST)
        if cached_ok:
            dns_cached_ms.append(cached_elapsed)
            dns_cached_handshakes.append(len(camo.snapshot()))
        camo.reset()
        reuse_ok, reuse_elapsed = dns_query(controller, OTHER_HOST_2)
        if reuse_ok:
            dns_reuse_ms.append(reuse_elapsed)
            dns_reuse_handshakes.append(len(camo.snapshot()))
        core.close()
    return {
        "profile": "sing-box",
        "protocol": protocol,
        "config_ms": round(material["last_yaml_ms"], 3),
        "startup_ms": _median(starts),
        "cold_ms": _median(cold),
        "warm_ms": _median(warm),
        "fake_ip_ms": _median(fake_ip_ms) if len(fake_ip_ms) == SAMPLES else None,
        "fake_ip_handshakes": _count(fake_ip_handshakes),
        "dns_ms": _median(dns_ms) if len(dns_ms) == SAMPLES else None,
        "dns_handshakes": _count(dns_handshakes),
        "dns_cached_ms": _median(dns_cached_ms) if len(dns_cached_ms) == SAMPLES else None,
        "dns_cached_handshakes": _count(dns_cached_handshakes),
        "dns_reuse_ms": _median(dns_reuse_ms) if len(dns_reuse_ms) == SAMPLES else None,
        "dns_reuse_handshakes": _count(dns_reuse_handshakes),
        "handshake_ms": _median(handshake_ms) if len(handshake_ms) == SAMPLES else None,
        "handshakes": _count(handshakes),
        "ok": _median(cold) is not None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    _assert_dns_sample_policy()
    mihomo, sing = ensure_bins()
    sing_client = ensure_singbox_client()
    work = Path("/tmp/tono-connect-bench")
    if work.exists():
        shutil.rmtree(work)
    work.mkdir()
    subprocess.run(
        [
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-keyout", str(work / "key.pem"),
            "-out", str(work / "cert.pem"), "-days", "2", "-nodes", "-subj", "/CN=bench.local",
            "-addext", "subjectAltName=DNS:bench.local,IP:127.0.0.2",
        ],
        check=True, capture_output=True,
    )
    bundle = Path("/etc/ssl/certs/ca-certificates.crt").read_bytes() + b"\n" + (work / "cert.pem").read_bytes()
    (work / "ca-bundle.pem").write_bytes(bundle)
    fingerprint = subprocess.check_output(
        ["openssl", "x509", "-in", str(work / "cert.pem"), "-noout", "-fingerprint", "-sha256"],
        text=True,
    ).split("=", 1)[1].replace(":", "").strip().lower()
    keys = subprocess.check_output([str(sing), "generate", "reality-keypair"], text=True)
    material = {"fingerprint": fingerprint, "last_yaml_ms": 0.0}
    for line in keys.splitlines():
        if line.startswith("PrivateKey:"):
            material["private"] = line.split(":", 1)[1].strip()
        if line.startswith("PublicKey:"):
            material["public"] = line.split(":", 1)[1].strip()

    camo = Camo(work / "cert.pem", work / "key.pem")
    origin = ThreadingHTTPServer(("127.0.0.2", 18080), Origin)
    threading.Thread(target=origin.serve_forever, daemon=True).start()
    doh = ThreadingHTTPServer(("127.0.0.2", 18443), Doh)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(work / "cert.pem", work / "key.pem")
    doh.socket = ctx.wrap_socket(doh.socket, server_side=True)
    threading.Thread(target=doh.serve_forever, daemon=True).start()
    threading.Thread(target=udp_dns, daemon=True).start()
    admitted = set(filter_servers(sing, work, material))
    server = subprocess.Popen(
        [str(sing), "run", "-c", str(work / "server.json")],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    wait_port(24431)
    rows = []
    slot = 0
    try:
        for protocol in ["vless", "hysteria2", "trojan", "vmess", "ss", "tuic"]:
            tag = {"hysteria2": "hy2"}.get(protocol, protocol)
            profiles = ["tono", "tono-fixed", "clash"] if protocol in {"vless", "hysteria2"} else ["clash"]
            if tag not in admitted:
                for profile in profiles:
                    rows.append({"profile": profile, "protocol": protocol, "ok": False, "note": "server unavailable"})
                continue
            for profile in profiles:
                print(f"measure {profile} {protocol}", flush=True)
                try:
                    rows.append(measure(mihomo, work, camo, profile, protocol, material, slot))
                except SystemExit as exc:
                    rows.append({"profile": profile, "protocol": protocol, "ok": False, "note": str(exc)})
                slot += 1
        for protocol in ("vless", "hysteria2"):
            tag = {"hysteria2": "hy2"}.get(protocol, protocol)
            if tag not in admitted:
                rows.append({"profile": "sing-box", "protocol": protocol, "ok": False, "note": "server unavailable"})
                continue
            print(f"measure sing-box {protocol}", flush=True)
            try:
                rows.append(measure_singbox(sing_client, work, camo, protocol, material, slot))
            except SystemExit as exc:
                rows.append({"profile": "sing-box", "protocol": protocol, "ok": False, "note": str(exc)})
            slot += 1
        extra = contention(mihomo, work, camo, material)
    finally:
        server.terminate()
        camo.close()
        origin.shutdown()
        doh.shutdown()
    report = {"camo_delay_ms": int(CAMO_DELAY_S * 1000), "rows": rows, "contention": extra}
    out = Path(__file__).resolve().parent / "last-run.json"
    out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if not args.check:
        return 0
    if not BASELINE.exists():
        print("no baseline.json", file=sys.stderr)
        return 1
    baseline = json.loads(BASELINE.read_text())
    failed = False
    for row in rows:
        if row.get("protocol") not in {"vless", "hysteria2"}:
            continue
        if row.get("profile") not in {"tono-fixed", "clash", "sing-box"}:
            continue
        for field in (
            "cold_ms",
            "dns_ms",
            "handshakes",
            "dns_handshakes",
            "fake_ip_ms",
            "fake_ip_handshakes",
            "dns_cached_ms",
            "dns_cached_handshakes",
            "dns_reuse_ms",
            "dns_reuse_handshakes",
        ):
            key = f"{row['protocol']}/{row['profile']}/{field}"
            if key not in baseline["limits"]:
                continue
            limit = baseline["limits"][key]
            got = row.get(field)
            if exceeds_limit(got, limit):
                print(f"REGRESSION {key}: {got} > {limit}", file=sys.stderr)
                failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
