#!/usr/bin/env python3
"""Local stand-ins for the Tono control plane, a cloud exit and a Home exit, for the on-device tunnel test.

Nothing here is a Tono server and no Tono account is used. The app (debug build only) is pointed at
the fake control plane through LocalTestServer; everything on the phone is the shipped code path:
sign-in, catalog admission, sing-box config, libbox core, Android VpnService/TUN, probes and UI.

  * control plane: plain HTTP on 127.0.0.1:28080, reached from the phone's loopback through `adb reverse`;
    email sign-in accepts only CODE, then serves a one-node catalog with a Home SOCKS5 exit;
  * cloud exit: the pinned sing-box CLI, VLESS + Reality + xtls-rprx-vision on CLOUD_IP:24443;
  * Home exit: the same sing-box, SOCKS5 with a password on HOME_IP:21080.

CLOUD_IP and HOME_IP are public-looking literals bound to the runner's loopback by the CI step (with a
REJECT rule so nothing addressed to them leaves the machine). The app's catalog admission insists on
public IPv4 exits and is not relaxed for the test; the emulator's user-mode network turns the
phone's connection to CLOUD_IP into a host connection, which lands on the loopback alias.

usage: fixture-servers.py serve <sing-box> <workdir>        (foreground; CI starts it in the background)
       fixture-servers.py check <exits.log> <requests.txt>   (after the test: which hop carried what)
"""
import base64
import hashlib
import http.server
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time

CLOUD_IP, CLOUD_PORT = "198.20.0.10", 24443
HOME_IP, HOME_PORT = "198.20.0.11", 21080
API_PORT = 28080
CODE = "246810"
REALITY_TARGET = "www.microsoft.com"
NODE = "Local test · Fixture"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def sha(text: str) -> str:
    return b64url(hashlib.sha256(text.encode()).digest())


def jwt() -> str:
    head = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = b64url(json.dumps({"sub": "local-test", "exp": int(time.time()) + 86400}).encode())
    return f"{head}.{body}.{b64url(b'local-test-not-signed')}"


def serve(singbox: str, work: str) -> None:
    os.makedirs(work, exist_ok=True)
    keys = subprocess.run([singbox, "generate", "reality-keypair"], check=True, capture_output=True, text=True).stdout
    private = re.search(r"PrivateKey:\s*(\S+)", keys).group(1)
    public = re.search(r"PublicKey:\s*(\S+)", keys).group(1)
    uuid = subprocess.run([singbox, "generate", "uuid"], check=True, capture_output=True, text=True).stdout.strip()
    short_id = secrets.token_hex(4)
    home_user, home_pass = "home-" + secrets.token_hex(3), secrets.token_hex(12)

    server = {
        "log": {"level": "info", "timestamp": True, "output": os.path.join(work, "sing-box.log")},
        "inbounds": [
            {
                "type": "vless", "tag": "cloud-in", "listen": CLOUD_IP, "listen_port": CLOUD_PORT,
                "users": [{"uuid": uuid, "flow": "xtls-rprx-vision"}],
                "tls": {
                    "enabled": True, "server_name": REALITY_TARGET,
                    "reality": {
                        "enabled": True, "handshake": {"server": REALITY_TARGET, "server_port": 443},
                        "private_key": private, "short_id": [short_id],
                    },
                },
            },
            {
                "type": "socks", "tag": "home-in", "listen": HOME_IP, "listen_port": HOME_PORT,
                "users": [{"username": home_user, "password": home_pass}],
            },
        ],
        "outbounds": [{"type": "direct", "tag": "direct"}],
        "route": {"final": "direct"},
    }
    config = os.path.join(work, "server.json")  # holds this run's throwaway keys; not uploaded
    with open(config, "w") as f:
        json.dump(server, f, indent=1)
    subprocess.run([singbox, "check", "-c", config], check=True)
    box = subprocess.Popen([singbox, "run", "-c", config])

    yaml = "\n".join([
        "proxies:",
        f"  - name: {NODE}",
        "    type: vless",
        f"    server: {CLOUD_IP}",
        f"    port: {CLOUD_PORT}",
        f"    uuid: {uuid}",
        "    network: tcp",
        "    tls: true",
        "    udp: true",
        f"    servername: {REALITY_TARGET}",
        "    client-fingerprint: chrome",
        "    flow: xtls-rprx-vision",
        "    reality-opts:",
        f"      public-key: {public}",
        f"      short-id: {short_id}",
        "",
    ])
    socks = {"host": HOME_IP, "port": HOME_PORT, "username": home_user, "password": home_pass}
    routing_sha = sha("\n".join(["", "", "\n".join([HOME_IP, str(HOME_PORT), home_user, home_pass])]))
    catalog = {"revision": 1, "yaml": yaml, "sha256": sha(yaml), "routing": {"homeSocks5": socks}, "routingSha256": routing_sha}
    # Scenarios a device test can switch to, so the real app reaches its failure states against these
    # stand-ins: "home-down" hands out a Home exit whose password the Home stand-in rejects (the Home
    # check fails after Connected: partly working); "catalog-unavailable" answers the catalog with the
    # control plane's CATALOG_UNAVAILABLE (the connect fails). Test fixtures only, never a Tono server.
    bad_socks = dict(socks, password="wrong-" + secrets.token_hex(6))
    bad_routing_sha = sha("\n".join(["", "", "\n".join([HOME_IP, str(HOME_PORT), home_user, bad_socks["password"]])]))
    home_down = dict(catalog, routing={"homeSocks5": bad_socks}, routingSha256=bad_routing_sha)
    scenario = {"name": "normal"}
    api_log = open(os.path.join(work, "control-plane.log"), "a", buffering=1)

    class Api(http.server.BaseHTTPRequestHandler):
        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, fmt, *args):
            api_log.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

        def do_GET(self):
            if self.path == "/healthz":
                return self.reply(200, {"ok": True})
            if self.path == "/api/v1/exit-catalog":
                if not (self.headers.get("Authorization") or "").startswith("Bearer "):
                    return self.reply(401, {"error": {"code": "UNAUTHORIZED", "message": "no token"}})
                if scenario["name"] == "catalog-unavailable":
                    return self.reply(503, {"error": {"code": "CATALOG_UNAVAILABLE", "message": "stand-in: catalog unavailable"}})
                return self.reply(200, home_down if scenario["name"] == "home-down" else catalog)
            self.reply(404, {"error": {"code": "NOT_FOUND", "message": self.path}})

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length) or b"{}")
            if self.path == "/api/v1/auth/email/start":
                return self.reply(200, {"challengeId": "local-" + secrets.token_hex(4)})
            if self.path == "/api/v1/auth/email/verify":
                if body.get("code") != CODE:
                    return self.reply(400, {"error": {"code": "INVALID_OR_EXPIRED_CODE", "message": "wrong code"}})
                return self.reply(200, {"accessToken": jwt(), "refreshToken": "local-" + secrets.token_hex(16), "user": {"email": "tester@local.test"}})
            if self.path == "/api/v1/auth/refresh":
                return self.reply(200, {"accessToken": jwt()})
            if self.path == "/api/v1/auth/logout":
                return self.reply(200, {})
            if self.path == "/fixture/scenario" and body.get("name") in ("normal", "home-down", "catalog-unavailable"):
                scenario["name"] = body["name"]
                api_log.write("%s scenario %s\n" % (time.strftime("%H:%M:%S"), scenario["name"]))
                return self.reply(200, scenario)
            self.reply(404, {"error": {"code": "NOT_FOUND", "message": self.path}})

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", API_PORT), Api)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    print(f"fixture servers up: control plane :{API_PORT}, cloud {CLOUD_IP}:{CLOUD_PORT}, home {HOME_IP}:{HOME_PORT}", flush=True)
    try:
        box.wait()
    finally:
        httpd.shutdown()


def check(exits_log: str, requests_file: str) -> int:
    """Each request the phone made must appear on the hop its routing class promises, and only there."""
    log = open(exits_log, errors="replace").read()

    def seen(tag, host):
        return re.search(rf"inbound/\w+\[{tag}\]: (?:\[[^\]]*\] )?inbound connection to {re.escape(host)}:\d+", log) is not None

    # (cloud exit sees the name, Home exit sees the name). Home traffic crosses the cloud exit inside the
    # SOCKS tunnel, so the cloud exit sees only the Home exit's address (checked as "chain" below).
    expect = {"home": (False, True), "cloud": (True, False), "direct": (False, False)}
    status, lines = 0, []
    for line in open(requests_file):
        parts = line.split()
        if len(parts) < 3 or parts[0] not in expect:
            continue
        kind, host, result = parts[0], parts[1], " ".join(parts[2:])
        want_cloud, want_home = expect[kind]
        got_cloud, got_home = seen("cloud-in", host), seen("home-in", host)
        ok = (got_cloud, got_home) == (want_cloud, want_home) and not result.startswith("ERROR")
        status |= 0 if ok else 1
        lines.append(f"{'ok  ' if ok else 'FAIL'} {kind:6} {host:28} phone: {result:24} cloud exit saw it: {got_cloud!s:5} Home exit saw it: {got_home!s:5}")
    # A Home request enters the cloud exit addressed to the Home exit: the cloud → Home chain itself.
    chained = seen("cloud-in", HOME_IP)
    lines.append(f"{'ok  ' if chained else 'FAIL'} chain  cloud exit opened {HOME_IP}:{HOME_PORT} (Home reached through the cloud): {chained}")
    status |= 0 if chained else 1
    if not lines[:-1]:
        lines.append("FAIL no requests recorded by the phone")
        status = 1
    print("\n".join(lines))
    return status


if __name__ == "__main__":
    if sys.argv[1:2] == ["serve"]:
        serve(sys.argv[2], sys.argv[3])
    elif sys.argv[1:2] == ["check"]:
        sys.exit(check(sys.argv[2], sys.argv[3]))
    else:
        sys.exit(__doc__)
