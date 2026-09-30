#!/usr/bin/env python3
"""Local connect bench: Tono's mihomo config vs a strict Clash config.

Loopback only. TUN, PF, WFP, system DNS and the host route table are not
touched. A short delay on the Reality camouflage accept makes each proxy
handshake visible; the same delay is applied to every profile.

Pinned cores:
  mihomo v1.19.30 (the client under test, stock build, not the Tono patch)
  sing-box 1.14.2 (local protocol servers)

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
UUID = "9e107d9d-372b-4c81-8d2b-3f2d0a1b2c3d"
SHORT_ID = "0123456789abcdef"
ORIGIN_HOST = "bench.tono.test"
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
        unpacked = next(CACHE.glob("sing-box-*/sing-box"))
        shutil.copy(unpacked, sing)
        sing.chmod(0o755)
    return mihomo, sing


def dns_reply(query: bytes) -> bytes:
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
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind(("127.0.0.2", 15353))
    while True:
        data, addr = sock.recvfrom(2048)
        sock.sendto(dns_reply(data), addr)


def wait_port(port: int, timeout: float = 3) -> None:
    deadline = time.perf_counter() + timeout
    while time.perf_counter() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), 0.2):
                return
        except OSError:
            time.sleep(0.02)
    raise SystemExit(f"port {port} did not open")


def dns_query(controller: int) -> tuple[bool, float]:
    url = f"http://127.0.0.1:{controller}/dns/query?name={ORIGIN_HOST}&type=A"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer bench"})
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            body = resp.read()
            ok = resp.status == 200 and b"127.0.0.2" in body
    except Exception:
        return False, (time.perf_counter() - started) * 1000
    return ok, (time.perf_counter() - started) * 1000


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


def measure(mihomo: Path, work: Path, camo: Camo, profile: str, protocol: str, material: dict, slot: int) -> dict:
    mixed = 30000 + slot
    controller = 31000 + slot
    config = work / f"{profile}-{protocol}.yaml"
    config.write_text(yaml_for(profile, protocol, material, mixed, controller))
    cold, warm, starts, handshakes = [], [], [], []
    dns_ms, dns_handshakes, handshake_ms = [], [], []
    for _ in range(SAMPLES):
        t0 = time.perf_counter()
        core = Core(mihomo, work, config, mixed, controller)
        starts.append((time.perf_counter() - t0) * 1000)
        camo.reset()
        dns_ok, dns_elapsed = dns_query(controller)
        dns_marks = camo.snapshot()
        if dns_ok:
            dns_ms.append(dns_elapsed)
            dns_handshakes.append(len(dns_marks))
        camo.reset()
        code, elapsed = curl(mixed, f"http://{ORIGIN_HOST}:18080/")
        marks = camo.snapshot()
        cold.append(elapsed if code == 200 else None)
        handshakes.append(len(marks))
        if code == 200 and marks:
            handshake_ms.append((marks[-1][1] - marks[-1][0]) * 1000)
        code2, elapsed2 = curl(mixed, f"http://{ORIGIN_HOST}:18080/")
        warm.append(elapsed2 if code2 == 200 else None)
        core.close()
    def med(values):
        nums = [v for v in values if v is not None]
        if len(nums) != len(values):
            return None
        return round(statistics.median(nums), 1)

    return {
        "profile": profile,
        "protocol": protocol,
        "config_ms": round(material["last_yaml_ms"], 3),
        "startup_ms": med(starts),
        "cold_ms": med(cold),
        "warm_ms": med(warm),
        "dns_ms": med(dns_ms) if len(dns_ms) == SAMPLES else None,
        "dns_handshakes": round(statistics.median(dns_handshakes), 1) if len(dns_handshakes) == SAMPLES else None,
        "handshake_ms": med(handshake_ms) if len(handshake_ms) == SAMPLES else None,
        "handshakes": round(statistics.median(handshakes), 1) if len(handshakes) == SAMPLES else None,
        "ok": med(cold) is not None,
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    mihomo, sing = ensure_bins()
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
        if row.get("profile") not in {"tono-fixed", "clash"}:
            continue
        for field in ("cold_ms", "dns_ms", "handshakes", "dns_handshakes"):
            key = f"{row['protocol']}/{row['profile']}/{field}"
            if key not in baseline["limits"]:
                continue
            limit = baseline["limits"][key]
            got = row.get(field)
            if got is None or got > limit:
                print(f"REGRESSION {key}: {got} > {limit}", file=sys.stderr)
                failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
