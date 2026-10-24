#!/usr/bin/env python3
"""Runs the pinned sing-box CLI on a generated mobile config and checks real routing decisions.

The platform-only pieces are swapped for local stand-ins, everything else (DNS rules, route rules,
selector, the Home SOCKS detour through the cloud exit) is the generated graph unchanged:
  * the TUN inbound becomes a SOCKS/mixed inbound with the same tag (+ a UDP DNS inbound on port 53);
  * every VLESS cloud node becomes a SOCKS outbound to a local "cloud" server;
  * the Home SOCKS server is pointed at a local "home" server, still detoured via Tono-Exit,
    so a Home request must traverse cloud → home.
The DIRECT outbound also becomes a local SOCKS stand-in with the same tag, and the local DNS server
becomes a local UDP stand-in, so any misroute or DNS leak is detected without contacting a public
destination or depending on system DNS.
The stand-in servers answer HTTP with which hop served them. Then the harness kills the Home
and cloud stand-ins and checks that matched traffic fails instead of leaving DIRECT.

usage: engine-route-harness.py <sing-box-binary> <config.json>
"""
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time

CLOUD_PORT, HOME_PORT, MIXED_PORT, DIRECT_PORT = 21080, 21081, 21090, 21095
DNS_IN_PORT, LOCAL_DNS_PORT = 21053, 21054
HOME_USER, HOME_PASS = "home-user", "home-pass"
# First-party X domain suffixes routed through the Cloud exit (after grok.x.com -> Home).
X_HOSTS = (
    "x.com", "www.x.com", "mobile.x.com", "api.x.com", "upload.x.com", "sso.x.com", "api-stream.x.com",
    "twitter.com", "www.twitter.com", "mobile.twitter.com", "api.twitter.com",
    "upload.twitter.com", "abs.twimg.com", "abs-0.twimg.com", "pbs.twimg.com", "video.twimg.com",
    "ton.twimg.com", "cdn.syndication.twimg.com", "t.co", "prod.pscp.tv", "periscope.tv",
    "cms-twdigitalassets.com", "vine.co", "twitpic.com",
)
# Overseas messaging, knowledge, community, streaming & developer ecosystems routed through Cloud.
OVERSEAS_CLOUD_HOSTS = (
    "telegram.org", "t.me", "cdn-telegram.org",
    "discord.com", "discord.gg", "cdn.discordapp.com", "signal.org", "line.me",
    "en.wikipedia.org", "commons.wikimedia.org", "archive.org", "medium.com", "substack.com",
    "v2ex.com", "nodeseek.com", "linux.do",
    "www.netflix.com", "open.spotify.com", "www.twitch.tv", "www.pixiv.net", "i.pximg.net",
    "huggingface.co", "hf.co", "www.npmjs.com", "pypi.org", "files.pythonhosted.org",
    "ghcr.io", "pages.github.io", "www.githubstatus.com", "app.vercel.app", "hub.docker.com",
    "registry-1.docker.io",
)
# Mobile Home aux suffixes (Google static/user-content/auth/regional, WhatsApp, LiveKit, anti-bot).
HOME_AUX_HOSTS = (
    "fpjs.io", "sift.com", "recaptcha.net", "appleid.apple.com", "segment.io", "launchdarkly.com",
    "stytch.com", "auth0.com", "authkit.app", "funcaptcha.com", "prodregistryv2.org",
    "www.gstatic.com", "lh3.googleusercontent.com", "1e100.net", "gvt1.com", "gvt2.com",
    "www.google.com.hk", "www.google.co.jp", "www.google.com.sg", "www.google.co.uk",
    "developer.android.com", "g.co", "goo.gl",
    "web.whatsapp.com", "mmg.whatsapp.net", "wa.me",
    "chatgpt.livekit.cloud",
    "registry.npmjs.org", "gateway.ai.cloudflare.com", "challenges.cloudflare.com",
)
TELEGRAM_DC_IPS = ("149.154.167.50", "91.108.56.130")


class LocalDnsStub(threading.Thread):
    """Minimal UDP DNS server stand-in for the `local` resolver to detect any DNS leak."""

    def __init__(self, port):
        super().__init__(daemon=True)
        self.port = port
        self.seen = []
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", port))
        self.running = True

    def stop(self):
        self.running = False
        self.sock.close()

    def run(self):
        while self.running:
            try:
                data, addr = self.sock.recvfrom(2048)
            except OSError:
                return
            try:
                txid = data[:2]
                idx = 12
                labels = []
                while idx < len(data) and data[idx] != 0:
                    ln = data[idx]
                    idx += 1
                    labels.append(data[idx:idx + ln].decode(errors="replace"))
                    idx += ln
                qname = ".".join(labels).lower()
                qtype = struct.unpack(">H", data[idx + 1:idx + 3])[0]
                self.seen.append((qname, qtype))
                question = data[12:idx + 5]
                if qtype == 1:
                    # Answer A 93.184.216.34
                    hdr = txid + struct.pack(">HHHHH", 0x8180, 1, 1, 0, 0)
                    rr = b"\xc0\x0c" + struct.pack(">HHIH", 1, 1, 60, 4) + socket.inet_aton("93.184.216.34")
                    self.sock.sendto(hdr + question + rr, addr)
                else:
                    hdr = txid + struct.pack(">HHHHH", 0x8180, 1, 0, 0, 0)
                    self.sock.sendto(hdr + question, addr)
            except Exception:
                pass


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
    config["inbounds"] = [
        {"type": "mixed", "tag": tun["tag"], "listen": "127.0.0.1", "listen_port": MIXED_PORT},
        {"type": "direct", "tag": "dns-in", "listen": "127.0.0.1", "listen_port": DNS_IN_PORT, "network": "udp", "override_address": "8.8.8.8", "override_port": 53},
    ]
    for i, srv in enumerate(config["dns"]["servers"]):
        if srv["tag"] == "local":
            config["dns"]["servers"][i] = {"type": "udp", "tag": "local", "server": "127.0.0.1", "server_port": LOCAL_DNS_PORT}
    for i, out in enumerate(config["outbounds"]):
        if out["type"] == "vless":
            config["outbounds"][i] = {"type": "socks", "tag": out["tag"], "server": "127.0.0.1", "server_port": CLOUD_PORT, "version": "5"}
        elif out["type"] == "direct":
            config["outbounds"][i] = {"type": "socks", "tag": out["tag"], "server": "127.0.0.1", "server_port": DIRECT_PORT, "version": "5"}
        elif out["type"] == "socks":
            out["server"], out["server_port"] = "127.0.0.1", HOME_PORT
    config["route"]["auto_detect_interface"] = False
    config.pop("experimental", None)
    config["log"] = {"level": "warn"}
    return config


def fetch(host, port=80, ipv4_literal=False):
    """HTTP GET through the mixed inbound with remote name resolution (or raw IPv4 when ipv4_literal=True)."""
    s = socket.create_connection(("127.0.0.1", MIXED_PORT), timeout=8)
    try:
        s.sendall(b"\x05\x01\x00")
        assert s.recv(2) == b"\x05\x00"
        if ipv4_literal:
            s.sendall(b"\x05\x01\x00\x01" + socket.inet_aton(host) + struct.pack(">H", port))
        else:
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


def query_dns(qname, qtype):
    """Send a UDP DNS query into sing-box's hijacked port-53 inbound and return (rcode, ancount, first_ipv4_or_none)."""
    labels = b"".join(bytes([len(p)]) + p.encode() for p in qname.split(".")) + b"\x00"
    pkt = struct.pack(">HHHHHH", 0x1337, 0x0100, 1, 0, 0, 0) + labels + struct.pack(">HH", qtype, 1)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.settimeout(3)
    try:
        s.sendto(pkt, ("127.0.0.1", DNS_IN_PORT))
        resp, _ = s.recvfrom(2048)
        _, flags, qdcount, ancount, _, _ = struct.unpack(">HHHHHH", resp[:12])
        rcode = flags & 0x0F
        ipv4 = socket.inet_ntoa(resp[-4:]) if (ancount >= 1 and qtype == 1 and len(resp) >= 4) else None
        return rcode, ancount, ipv4
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
    direct = Socks5Stub(DIRECT_PORT, "direct")
    local_dns = LocalDnsStub(LOCAL_DNS_PORT)
    cloud.start(); home.start(); direct.start(); local_dns.start()
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
        json.dump(config, f)
    proc = subprocess.Popen([binary, "run", "-c", f.name], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    time.sleep(1.5)
    failures = []

    def expect(host, want, port=80, ipv4_literal=False):
        got = fetch(host, port, ipv4_literal=ipv4_literal)
        ok = got == want if not want.startswith("!") else not got.startswith(want[1:]) and got not in ("direct",)
        label = f"{host} (raw-ip)" if ipv4_literal else host
        print(f"{'ok  ' if ok else 'FAIL'} {label:38} -> {got:22} (want {want})")
        if not ok:
            failures.append(label)

    print("== live stand-ins")
    expect("claude.ai", ai)
    expect("api.anthropic.com", ai)
    expect("generativelanguage.googleapis.com", ai)
    expect("youtubei.googleapis.com", "cloud")
    expect("www.youtube.com", "cloud")
    expect("yt3.googleusercontent.com", "cloud")
    expect("yt3.ggpht.com", "cloud")
    expect("www.cloudflare.com", "cloud")
    expect("example.com", ordinary)
    expect("grok.x.com", ai)
    expect("api.grok.x.com", ai)
    expect("grok.com", ai)
    expect("x.ai", ai)
    for host in HOME_AUX_HOSTS:
        expect(host, ai)
    for host in X_HOSTS:
        expect(host, "cloud")
    for host in OVERSEAS_CLOUD_HOSTS:
        expect(host, "cloud")
    for ip in TELEGRAM_DC_IPS:
        expect(ip, "cloud", port=443, ipv4_literal=True)
    # Shared CDN and unrelated lookalike suffixes stay on the ordinary path in Three-Tier.
    for host in ("x.com.example.net", "unrelated.akamaized.net"):
        expect(host, ordinary)

    # Protected / Home / Cloud names are FakeIP in every mode. ipinfo.io is not on those
    # lists: stable's catch-all still FakeIPs it, and three-tier sends it to the local
    # resolver (same contract as www.baidu.com). The stub answers A with 93.184.216.34,
    # so that address means "this query left the process", not a public resolver.
    protected_dns = ("claude.ai", "www.gstatic.com", "web.whatsapp.com", "x.com", "telegram.org", "huggingface.co")
    unmatched_dns = "ipinfo.io"
    other_qtypes = (("HTTPS", 65), ("SVCB", 64), ("TXT", 16), ("SRV", 33), ("CAA", 257))

    def expect_fakeip(qname):
        rcode_a, an_a, ip_a = query_dns(qname, 1)  # A
        ok_a = rcode_a == 0 and an_a == 1 and ip_a is not None and ip_a.startswith("198.18.")
        print(f"{'ok  ' if ok_a else 'FAIL'} DNS A    {qname:33} -> rcode={rcode_a} an={an_a} ip={ip_a}")
        if not ok_a:
            failures.append(f"dns-A:{qname}")
        for qtype_name, qtype_num in other_qtypes:
            rcode_q, an_q, _ = query_dns(qname, qtype_num)
            ok_q = rcode_q == 0 and an_q == 0
            if not ok_q:
                print(f"FAIL DNS {qtype_name:5} {qname:33} -> rcode={rcode_q} an={an_q} (want rcode=0 an=0)")
                failures.append(f"dns-{qtype_name}:{qname}")

    print("== zero-leak DNS checks (protected names: A -> fakeip, other types -> predefined NOERROR)")
    local_dns.seen.clear()
    for qname in protected_dns:
        expect_fakeip(qname)
    if ordinary == "direct":
        rcode_a, an_a, ip_a = query_dns(unmatched_dns, 1)
        ok_a = rcode_a == 0 and an_a == 1 and ip_a == "93.184.216.34"
        print(f"{'ok  ' if ok_a else 'FAIL'} DNS A    {unmatched_dns:33} -> rcode={rcode_a} an={an_a} ip={ip_a} (three-tier local)")
        if not ok_a:
            failures.append(f"dns-A:{unmatched_dns}")
        for qtype_name, qtype_num in other_qtypes:
            rcode_q, an_q, _ = query_dns(unmatched_dns, qtype_num)
            ok_q = rcode_q == 0 and an_q == 0
            if not ok_q:
                print(f"FAIL DNS {qtype_name:5} {unmatched_dns:33} -> rcode={rcode_q} an={an_q} (want rcode=0 an=0)")
                failures.append(f"dns-{qtype_name}:{unmatched_dns}")
        expected_local = [(unmatched_dns, 1)] + [(unmatched_dns, qtype_num) for _, qtype_num in other_qtypes]
        protected_leaks = [item for item in local_dns.seen if item[0] != unmatched_dns]
        if protected_leaks or local_dns.seen != expected_local:
            print(f"FAIL local DNS query set: {local_dns.seen} (want only {expected_local})")
            failures.append(f"dns-leak:{local_dns.seen}")
        else:
            print(f"ok   three-tier local DNS saw only {unmatched_dns} ({len(local_dns.seen)} queries); protected names stayed FakeIP")
    else:
        expect_fakeip(unmatched_dns)
        if local_dns.seen:
            print(f"FAIL local DNS leaked protected queries: {local_dns.seen}")
            failures.append(f"dns-leak:{local_dns.seen}")
        else:
            print("ok   local DNS saw 0 protected/Home/Cloud/catch-all queries across A/HTTPS/SVCB/TXT/SRV/CAA")

    print(f"   home saw via cloud relay: {home.seen[:3]} … cloud saw: {[s for s in cloud.seen if '21081' in s][:1]}")
    print("== Home stand-in down")
    home.stop(); time.sleep(0.3)
    for host in (("claude.ai", "chatgpt.com", "www.gstatic.com", "web.whatsapp.com") if socks_home else ()):
        got = fetch(host)
        ok = got not in ("direct", "home", "cloud")
        print(f"{'ok  ' if ok else 'FAIL'} {host:38} -> {got:22} (must fail, never direct)")
        if not ok:
            failures.append(host + "/home-down")
    expect("example.com", ordinary)
    print("== cloud stand-in down")
    cloud.stop(); time.sleep(0.3)
    for host in ("www.youtube.com", "claude.ai", "grok.x.com", "telegram.org", "discord.com", "huggingface.co") + X_HOSTS:
        got = fetch(host)
        ok = got not in ("direct", "home", "cloud")
        print(f"{'ok  ' if ok else 'FAIL'} {host:38} -> {got:22} (must fail, never direct)")
        if not ok:
            failures.append(host + "/cloud-down")
    for ip in TELEGRAM_DC_IPS:
        got = fetch(ip, port=443, ipv4_literal=True)
        ok = got not in ("direct", "home", "cloud")
        print(f"{'ok  ' if ok else 'FAIL'} {ip + ' (raw-ip)':38} -> {got:22} (must fail, never direct)")
        if not ok:
            failures.append(ip + "/cloud-down")
    if ordinary == "direct":
        expect("example.com", "direct")
    else:
        got = fetch("example.com")
        ok = got not in ("direct", "home", "cloud")
        print(f"{'ok  ' if ok else 'FAIL'} {'example.com':38} -> {got:22} (stable: cloud down must fail, never direct)")
        if not ok:
            failures.append("example.com/stable-cloud-down")
    direct.stop(); local_dns.stop()
    proc.terminate()
    out = proc.communicate(timeout=5)[0]
    os.unlink(f.name)
    if failures:
        print("sing-box log tail:\n" + "\n".join(out.splitlines()[-20:]))
        sys.exit(f"{len(failures)} routing expectation(s) failed: {failures}")
    print("all engine routing expectations passed")


if __name__ == "__main__":
    main()
