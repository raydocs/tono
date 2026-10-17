#!/usr/bin/env python3
"""Runs the pinned sing-box CLI on a generated Android config and checks real routing decisions.

The Android-only pieces are swapped for local stand-ins, everything else (DNS rules, route rules,
selector, the Home SOCKS detour through the cloud exit) is the generated graph unchanged:
  * the TUN inbound becomes a SOCKS/mixed inbound with the same tag;
  * every VLESS cloud node becomes a SOCKS outbound to a local "cloud" server;
  * the Home SOCKS server is pointed at a local "home" server, still detoured via Tono-Exit,
    so a Home request must traverse cloud → home.
The stand-in servers answer HTTP with which hop served them. Then the harness kills the Home
and cloud stand-ins and checks that matched traffic fails instead of leaving DIRECT.

usage: engine-route-harness.py <sing-box-binary> <config.json>
"""
import asyncio
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request

CLOUD_PORT, HOME_PORT, MIXED_PORT, DIRECT_PORT = 21080, 21081, 21090, 21095
HOME_USER, HOME_PASS = "home-user", "home-pass"


class Socks5Stub(threading.Thread):
    """Minimal SOCKS5 CONNECT server. Relays CONNECTs to `relay_ports`, answers everything else."""

    def __init__(self, port, name, relay_ports=(), auth=None):
        super().__init__(daemon=True)
        self.port, self.name, self.relay_ports, self.auth = port, name, set(relay_ports), auth
        self.seen = []
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.sock.listen(64)
        self.running = True

    def stop(self):
        self.running = False
        try:
            self.sock.shutdown(socket.SHUT_RDWR)  # wakes a blocked accept(); close() alone may accept once more
        except OSError:
            pass
        self.sock.close()

    def run(self):
        while self.running:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self.handle, args=(conn,), daemon=True).start()

    def recv(self, conn, n):
        data = b""
        while len(data) < n:
            chunk = conn.recv(n - len(data))
            if not chunk:
                raise ConnectionError
            data += chunk
        return data

    def handle(self, conn):
        try:
            ver, nmethods = self.recv(conn, 2)
            methods = self.recv(conn, nmethods)
            if self.auth:
                conn.sendall(b"\x05\x02")
                self.recv(conn, 1)
                user = self.recv(conn, self.recv(conn, 1)[0]).decode()
                pw = self.recv(conn, self.recv(conn, 1)[0]).decode()
                ok = (user, pw) == self.auth
                conn.sendall(b"\x01\x00" if ok else b"\x01\x01")
                if not ok:
                    return
            else:
                conn.sendall(b"\x05\x00")
            _, cmd, _, atyp = self.recv(conn, 4)
            if atyp == 1:
                host = socket.inet_ntoa(self.recv(conn, 4))
            elif atyp == 3:
                host = self.recv(conn, self.recv(conn, 1)[0]).decode()
            else:
                host = socket.inet_ntop(socket.AF_INET6, self.recv(conn, 16))
            port = struct.unpack(">H", self.recv(conn, 2))[0]
            self.seen.append(f"{host}:{port}")
            if port in self.relay_ports and host in ("127.0.0.1", "localhost"):
                upstream = socket.create_connection(("127.0.0.1", port))
                conn.sendall(b"\x05\x00\x00\x01" + socket.inet_aton("0.0.0.0") + b"\x00\x00")
                pipe(conn, upstream)
                return
            conn.sendall(b"\x05\x00\x00\x01" + socket.inet_aton("0.0.0.0") + b"\x00\x00")
            conn.recv(65536)
            body = f"served-by={self.name} target={host}:{port}\n".encode()
            conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % len(body) + body)
        except Exception:
            pass
        finally:
            conn.close()


def pipe(a, b):
    def forward(src, dst):
        try:
            while True:
                data = src.recv(65536)
                if not data:
                    break
                dst.sendall(data)
        except OSError:
            pass
        finally:
            try:
                dst.shutdown(socket.SHUT_WR)
            except OSError:
                pass
    t = threading.Thread(target=forward, args=(b, a), daemon=True)
    t.start()
    forward(a, b)
    t.join(5)
    a.close(); b.close()


def transform(config):
    tun = config["inbounds"][0]
    config["inbounds"] = [{"type": "mixed", "tag": tun["tag"], "listen": "127.0.0.1", "listen_port": MIXED_PORT}]
    for i, out in enumerate(config["outbounds"]):
        if out["type"] == "vless":
            config["outbounds"][i] = {"type": "socks", "tag": out["tag"], "server": "127.0.0.1", "server_port": CLOUD_PORT, "version": "5"}
        elif out["type"] == "socks":
            out["server"], out["server_port"] = "127.0.0.1", HOME_PORT
    config["route"]["auto_detect_interface"] = False
    config.pop("experimental", None)
    config["log"] = {"level": "warn"}
    return config


def fetch(host, port=80):
    """HTTP GET through the mixed inbound with remote name resolution (the name reaches sing-box)."""
    s = socket.create_connection(("127.0.0.1", MIXED_PORT), timeout=8)
    try:
        s.sendall(b"\x05\x01\x00")
        assert s.recv(2) == b"\x05\x00"
        s.sendall(b"\x05\x01\x00\x03" + bytes([len(host)]) + host.encode() + struct.pack(">H", port))
        reply = s.recv(10)
        if len(reply) < 2 or reply[1] != 0:
            return f"socks-error-{reply[1] if len(reply) > 1 else 'eof'}"
        s.sendall(f"GET / HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode())
        data = b""
        while True:
            chunk = s.recv(65536)
            if not chunk:
                break
            data += chunk
        text = data.decode(errors="replace")
        if "served-by=" in text:
            return text.split("served-by=")[1].split()[0]
        return "direct" if text.startswith("HTTP/") else "empty"
    except (OSError, AssertionError) as e:
        return f"failed({type(e).__name__})"
    finally:
        s.close()


def main():
    binary, path = sys.argv[1], sys.argv[2]
    config = transform(json.load(open(path)))
    # Three-tier sends ordinary destinations DIRECT; stable ("稳定") sends them through the cloud exit.
    ordinary = "direct" if config["route"]["final"] == "direct" else "cloud"
    # Without a residential SOCKS Home, AI goes to Tono-Exit (unbound) or a catalog Home node; both
    # are SOCKS stand-ins on the cloud port here. Either way it is never DIRECT.
    socks_home = any(o["type"] == "socks" and o["server_port"] == HOME_PORT for o in config["outbounds"])
    ai = "home" if socks_home else "cloud"
    cloud = Socks5Stub(CLOUD_PORT, "cloud", relay_ports=[HOME_PORT])
    home = Socks5Stub(HOME_PORT, "home", auth=(HOME_USER, HOME_PASS))
    cloud.start(); home.start()
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(config, f)
    proc = subprocess.Popen([binary, "run", "-c", f.name], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    time.sleep(1.5)
    failures = []

    def expect(host, want, port=80):
        got = fetch(host, port)
        ok = got == want if not want.startswith("!") else not got.startswith(want[1:]) and got not in ("direct",)
        print(f"{'ok  ' if ok else 'FAIL'} {host:38} -> {got:22} (want {want})")
        if not ok:
            failures.append(host)

    print("== live stand-ins")
    expect("claude.ai", ai)
    expect("api.anthropic.com", ai)
    expect("generativelanguage.googleapis.com", ai)
    expect("youtubei.googleapis.com", "cloud")
    expect("www.youtube.com", "cloud")
    expect("www.cloudflare.com", "cloud")
    expect("example.com", ordinary)
    print(f"   home saw via cloud relay: {home.seen[:3]} … cloud saw: {[s for s in cloud.seen if '21081' in s][:1]}")
    print("== Home stand-in down")
    home.stop(); time.sleep(0.3)
    for host in (("claude.ai", "chatgpt.com") if socks_home else ()):
        got = fetch(host)
        ok = got not in ("direct", "home", "cloud")
        print(f"{'ok  ' if ok else 'FAIL'} {host:38} -> {got:22} (must fail, never direct)")
        if not ok:
            failures.append(host + "/home-down")
    expect("example.com", ordinary)
    print("== cloud stand-in down")
    cloud.stop(); time.sleep(0.3)
    for host in ("www.youtube.com", "claude.ai"):
        got = fetch(host)
        ok = got not in ("direct", "home", "cloud")
        print(f"{'ok  ' if ok else 'FAIL'} {host:38} -> {got:22} (must fail, never direct)")
        if not ok:
            failures.append(host + "/cloud-down")
    if ordinary == "direct":
        expect("example.com", "direct")
    else:
        got = fetch("example.com")
        ok = got not in ("direct", "home", "cloud")
        print(f"{'ok  ' if ok else 'FAIL'} {'example.com':38} -> {got:22} (stable: cloud down must fail, never direct)")
        if not ok:
            failures.append("example.com/stable-cloud-down")
    proc.terminate()
    out = proc.communicate(timeout=5)[0]
    os.unlink(f.name)
    if failures:
        print("sing-box log tail:\n" + "\n".join(out.splitlines()[-20:]))
        sys.exit(f"{len(failures)} routing expectation(s) failed: {failures}")
    print("all engine routing expectations passed")


if __name__ == "__main__":
    main()
