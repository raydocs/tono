#!/usr/bin/env python3
"""Tono network acceptance check for a machine inside mainland China. Python 3.8+, stdlib only.

One command, no account, no secret, nothing installed:

    python3 cn_acceptance.py --label "上海 移动 家宽" --carrier cmcc

It checks, from this machine, every network path a Tono client uses before and after sign-in:

  1. network identity hints   public IP prefix, ASN and city via a neutral lookup (skipped if blocked)
  2. DNS                      system resolution of the API and release hosts vs Cloudflare's ranges
  3. API (sign-in path)       TLS + GET /api/v1/health via system DNS, the two pinned Cloudflare
                              addresses and the two Tono relays (SNI api.afk.ccwu.cc, normal
                              certificate verification); the same order of paths the clients walk
  4. release host (updater)   the update manifest / appcast GETs via direct and via each relay
  5. exit nodes               TCP connect to each customer node's Reality port (443), IPs from the
                              repo's public sources only; optional real hy2 handshake through
                              ../hy2/hy2_probe.py when you pass --hy2-auth-file
  6. IPv6                     whether AAAA resolves and whether IPv6 TCP + TLS to the API works

Every check prints one PASS / FAIL / UNKNOWN line with a short reason; at the end a matrix and
a JSON summary file (tono-cn-acceptance-<time>.json) that you send back. The summary holds no
credential, no full IP address (only the /24 or /48 prefix) and no file paths.

hy2 (optional): --hy2-auth-file is a 0600 file holding a dedicated test account UUID; it is only
handed to hy2_probe.py by path and never read, printed or stored here. hy2_probe.py also needs the
official `hysteria` client (--hysteria) and each node's public leaf certificate as <ip>.pem in
--hy2-cert-dir (it checks the certificate against the catalog fingerprint; no skip-verify).

Exit code: 0 no FAIL, 2 at least one FAIL, 1 setup error. See README.md next to this file and
docs/ops/cn-acceptance.md for what each result means for customers.
"""

from __future__ import annotations

import argparse
import datetime
import errno
import hashlib
import http.client
import ipaddress
import json
import os
import platform
import shutil
import socket
import ssl
import statistics
import subprocess
import sys
import threading
import time
import urllib.request

SCHEMA = "tono.cn-acceptance.v1"
API_HOST = "api.afk.ccwu.cc"
RELEASES_HOST = "releases.afk.ccwu.cc"
HEALTH_PATH = "/api/v1/health"
# apps/windows/app/src-tauri/src/tono/bootstrap.rs API_BOOTSTRAP_IPS, apps/macos Info.plist.
PINNED = ("104.20.26.170", "172.66.162.98")
# bootstrap.rs API_RELAYS, apps/macos/Tono/Services/ControlPlanePath.swift, docs/ops/api-relay.md.
RELAYS = (("Westwood", "179.253.233.220", 2053), ("Mesa", "179.255.154.17", 2053))
# What the clients fetch to look for an update:
#   apps/windows/service/src/update_wire.rs DISCOVERY_URL and
#   apps/macos/Tono/Services/NativeUpdateDownload.swift origin + "latest/manifest.json";
#   apps/macos/Tono/Info.plist SUFeedURL (Sparkle, the published 0.0.67 line).
UPDATE_TARGETS = (
    ("manifest", RELEASES_HOST, "/desktop/v1/latest/manifest.json"),
    ("appcast", API_HOST, "/appcast.xml"),
)
# Customer exit nodes with a public IPv4 in this repository (never the private catalog sources,
# never credentials). Name, IPv4, hy2 leaf SHA-256 (or None), where the repo states the IP.
NODES = (
    ("Buffalo · Niagara", "23.94.79.123",
     "1e5374a79bdb83b04c3d3c84722c03211d1c941c2de9f92431d2198ba7212cad",
     "tooling/scripts/write-dedirock-hy2-catalog-sources.rb"),
    ("Buffalo · Erie", "198.46.140.254",
     "4a66f10676ca881186be350d16b3f86cb36f9c896ef445a692d5cc0bc8b5b201",
     "tooling/scripts/write-dedirock-hy2-catalog-sources.rb"),
    ("Los Angeles · Sunset", "192.236.205.232",
     "0ff3ab6b1bec3a3766f88955a84064ae73ea4724cb4d8602780e06dfbceceeb7",
     "tooling/scripts/write-dedirock-hy2-catalog-sources.rb"),
    ("Los Angeles · Mesa (Dedirock, 2026-09)", "107.174.123.27",
     "f59731347bf068d79f9d9e78c074e4686b981383a5c9029a5650e703e6afba41",
     "tooling/scripts/write-dedirock-hy2-catalog-sources.rb"),
    ("US-VLESS-Reality (Grove)", "198.12.84.154",
     "a4a8308980004c8a5cda98597b87986671f230445df863c23d380f012c72f909",
     "tooling/scripts/write-dedirock-hy2-catalog-sources.rb"),
    ("Los Angeles · Marina", "144.225.255.114", None, "docs/ops/transport-hy2.md"),
    ("Los Angeles · Westwood", "179.253.233.220", None, "docs/ops/api-relay.md"),
    ("Los Angeles · Mesa (DMIT)", "179.255.154.17", None, "docs/ops/api-relay.md"),
    ("Tokyo · Sakura", "162.4.194.103", None, "docs/reports/FLEET_EXIT_AGENT_ROLLOUT_2026-09-24.md"),
)
REALITY_PORT = 443
HY2_SNI = "www.microsoft.com"  # every hy2 block in write-dedirock-hy2-catalog-sources.rb
# RFC 5737 TEST-NET-1: never routed. If a TCP connect to it succeeds, something on this network
# answers every TCP connect itself (transparent proxy), and a bare TCP connect proves nothing.
TCP_CONTROL = ("192.0.2.1", 443)
# https://www.cloudflare.com/ips-v4 and /ips-v6 (2026-10).
CLOUDFLARE_NETS = tuple(ipaddress.ip_network(n) for n in (
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
    "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
    "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
    "2a06:98c0::/29", "2c0f:f248::/32",
))
IDENTITY_SOURCES = ("https://ipinfo.io/json", "https://api.ip.sb/geoip")
# Cloudflare's browser-integrity check answers a bare library User-Agent with 403/1010.
USER_AGENT = "Mozilla/5.0 (compatible; tono-cn-acceptance/1)"
NO_ROUTE = {errno.ENETUNREACH, errno.EHOSTUNREACH, errno.EADDRNOTAVAIL, 10051, 10065, 10049}
SLOW_CONNECT_MS = 900  # a lost first SYN costs ~1 s: the China Mobile -> CMI pattern in transport-hy2.md

PASS, FAIL, UNKNOWN = "PASS", "FAIL", "UNKNOWN"


# ---------------------------------------------------------------- classification (unit-tested)

def classify_addresses(addresses):
    """System DNS answer for a Cloudflare-fronted host -> (result, code, reason)."""
    if not addresses:
        return FAIL, "no-address", "resolver returned no address"
    outside = []
    for text in addresses:
        addr = ipaddress.ip_address(text.split("%")[0])
        if not any(addr in net for net in CLOUDFLARE_NETS):
            bogon = not addr.is_global
            outside.append(f"{text}{' (bogon)' if bogon else ''}")
    if outside:
        return FAIL, "not-cloudflare", ("answer outside Cloudflare ranges, likely poisoned: "
                                        + ", ".join(outside[:4]))
    return PASS, "cloudflare", f"{len(addresses)} address(es), all in Cloudflare ranges"


def classify_error(stage, error, ca_store_ok=True):
    """A network exception at stage tcp|tls|http -> (result, code, reason)."""
    if isinstance(error, socket.gaierror):
        return FAIL, "dns", f"name resolution failed: {error.strerror or error}"
    if isinstance(error, ssl.SSLCertVerificationError):
        detail = getattr(error, "verify_message", None) or getattr(error, "reason", None) or "verify failed"
        if not ca_store_ok:
            return UNKNOWN, "local-ca-store", (f"certificate check failed ({detail}) and this Python has no CA "
                                               "store; see README (Install Certificates)")
        return FAIL, "cert-invalid", (f"certificate not valid for the host ({detail}): TLS interception "
                                      "or a wrong endpoint")
    if isinstance(error, (socket.timeout, TimeoutError)):
        what = {"tcp": "TCP connect (SYN unanswered)", "tls": "TLS handshake", "http": "HTTP answer"}[stage]
        return FAIL, f"{stage}-timeout", f"{what} timed out"
    if isinstance(error, ConnectionRefusedError):
        return FAIL, "tcp-refused", "connection refused"
    if isinstance(error, ConnectionResetError):
        if stage == "tls":
            return FAIL, "tls-reset", "reset during the TLS handshake (typical of SNI filtering)"
        return FAIL, f"{stage}-reset", f"connection reset ({stage})"
    if isinstance(error, (ssl.SSLEOFError, ssl.SSLZeroReturnError)):
        return FAIL, f"{stage}-eof", f"peer closed the connection during {stage.upper()}"
    if isinstance(error, ssl.SSLError):
        return FAIL, "tls-error", f"TLS error: {getattr(error, 'reason', None) or error}"
    if isinstance(error, OSError) and error.errno in NO_ROUTE:
        return FAIL, "no-route", f"no route from this machine ({error.strerror or error})"
    if isinstance(error, http.client.HTTPException):
        return FAIL, "http-error", f"bad HTTP answer: {type(error).__name__}"
    if isinstance(error, OSError):
        return FAIL, f"{stage}-error", f"{stage}: {error.strerror or error}"
    return FAIL, "error", f"{type(error).__name__}: {error}"


def classify_health(status, body):
    """GET /api/v1/health answer -> (result, code, reason)."""
    if status == 200:
        try:
            parsed = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            parsed = None
        if isinstance(parsed, dict) and parsed.get("ok") is True and parsed.get("service") == "api":
            return PASS, "health-ok", "health ok"
        return FAIL, "unexpected-body", "HTTP 200 but not the Tono API answer (captive portal or interception)"
    return _http_failure(status, body)


def classify_update(kind, status, body):
    """Update discovery GET answer -> (result, code, reason)."""
    if kind == "manifest":
        if status == 200:
            try:
                json.loads(body.decode("utf-8"))
                return PASS, "manifest", f"manifest {len(body)} bytes"
            except (UnicodeDecodeError, ValueError):
                return FAIL, "unexpected-body", "HTTP 200 but not a JSON manifest"
        if status == 404 and body.strip() == b"Not found":
            return PASS, "no-manifest", "release host answered 404: no desktop/v1 manifest is published"
    elif status == 200:
        if b"<rss" in body[:2048]:
            return PASS, "appcast", f"appcast {len(body)} bytes"
        return FAIL, "unexpected-body", "HTTP 200 but not a Sparkle appcast"
    return _http_failure(status, body)


def _http_failure(status, body):
    if status == 403 and b"1010" in body:
        return FAIL, "cf-1010", "Cloudflare refused this client (403 / error 1010)"
    if 300 <= status < 400:
        return FAIL, "redirect", f"HTTP {status} redirect (captive portal?)"
    return FAIL, f"http-{status}", f"HTTP {status}"


def classify_tcp_series(samples, intercepted=False):
    """Connect times in ms (None = failed) for one Reality port -> (result, code, reason)."""
    ok = [s for s in samples if s is not None]
    if intercepted:
        return UNKNOWN, "tcp-intercepted", ("this network answers every TCP connect itself "
                                            "(control address accepted); TCP reachability not measurable")
    if not ok:
        return FAIL, "tcp-blocked", f"0/{len(samples)} connects"
    median = statistics.median(ok)
    reason = f"{len(ok)}/{len(samples)} connects, median {median:.0f} ms"
    if len(ok) < len(samples):
        return FAIL, "tcp-lossy", reason
    if median >= SLOW_CONNECT_MS:
        return PASS, "tcp-slow", reason + " (slow: first SYN lost, retransmitted)"
    return PASS, "tcp-ok", reason


def classify_hy2(stdout, returncode):
    """hy2_probe.py output (one JSON line, schema tono.hy2-probe.v1) -> (result, code, reason)."""
    report = None
    for line in reversed((stdout or "").splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                report = json.loads(line)
            except ValueError:
                continue
            break
    if returncode == 1 or not isinstance(report, dict) or report.get("schema") != "tono.hy2-probe.v1":
        return UNKNOWN, "hy2-setup", "hy2_probe.py did not run a handshake (setup error)"
    attempts = report.get("attempts") or 0
    reason = f"{report.get('handshakeOk', 0)}/{attempts} handshakes, {report.get('ok', 0)}/{attempts} tunnelled connects"
    ms = report.get("connectMs")
    if ms:
        reason += f", median {ms.get('median')} ms"
    if report.get("failures"):
        reason += " " + json.dumps(report["failures"], sort_keys=True)
    verdict = report.get("verdict")
    if verdict == "ok":
        return PASS, "hy2-ok", reason
    return FAIL, f"hy2-{verdict or 'failed'}", reason


def parse_identity(source, payload):
    """ipinfo.io / ip.sb JSON -> identity dict with the address cut to its /24 or /48."""
    if "ipinfo.io" in source:
        org = str(payload.get("org") or "")
        asn, _, name = org.partition(" ")
        asn = asn[2:] if asn.upper().startswith("AS") and asn[2:].isdigit() else None
        out = {"asn": int(asn) if asn else None, "org": name if asn else org,
               "country": payload.get("country"), "region": payload.get("region"), "city": payload.get("city")}
    else:
        asn = payload.get("asn")
        out = {"asn": int(asn) if str(asn or "").isdigit() else None,
               "org": payload.get("asn_organization") or payload.get("organization"),
               "country": payload.get("country_code"), "region": payload.get("region"), "city": payload.get("city")}
    out["ipPrefix"] = mask_ip(str(payload.get("ip") or ""))
    out["source"] = source
    return out


def mask_ip(text):
    try:
        addr = ipaddress.ip_address(text)
    except ValueError:
        return None
    bits = 24 if addr.version == 4 else 48
    return str(ipaddress.ip_network(f"{addr}/{bits}", strict=False))


def customer_verdict(results):
    """Best outcome a client gets from the paths of one capability, in the client's order."""
    by_kind = {}
    for kind, result in results:
        by_kind.setdefault(kind, []).append(result)
    if any(r == PASS for k in ("pinned", "system_dns", "direct") for r in by_kind.get(k, [])):
        return "direct"
    if PASS in by_kind.get("relay", []):
        return "relay-only"
    if all(r == UNKNOWN for _, r in results):
        return "unknown"
    return "blocked"


# ---------------------------------------------------------------- network primitives

def bounded(fn, seconds):
    """Run fn in a daemon thread; TimeoutError if it has not returned in `seconds` (getaddrinfo has no timeout)."""
    box = {}

    def run():
        try:
            box["value"] = fn()
        except BaseException as error:  # noqa: BLE001 - re-raised in the caller's thread
            box["error"] = error

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    worker.join(seconds)
    if worker.is_alive():
        raise TimeoutError(f"no answer within {seconds:.0f} s")
    if "error" in box:
        raise box["error"]
    return box["value"]


class ProbeError(Exception):
    def __init__(self, stage, error, timings):
        super().__init__(str(error))
        self.stage, self.error, self.timings = stage, error, timings


def https_get(host, path, addr, port, timeout, context, max_bytes=65536):
    """TCP to addr:port, TLS with SNI/verification for `host`, one GET. Returns timings + answer."""
    timings = {}
    started = time.monotonic()
    stage = "tcp"
    sock = None
    try:
        raw = socket.create_connection((addr, port), timeout=timeout)
        timings["tcpMs"] = round((time.monotonic() - started) * 1000)
        stage = "tls"
        try:
            sock = context.wrap_socket(raw, server_hostname=host)
        except BaseException:
            raw.close()
            raise
        timings["tlsMs"] = round((time.monotonic() - started) * 1000) - timings["tcpMs"]
        timings["tlsVersion"] = sock.version()
        stage = "http"
        request = (f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUser-Agent: {USER_AGENT}\r\n"
                   "Accept: */*\r\nConnection: close\r\n\r\n")
        sock.sendall(request.encode("ascii"))
        response = http.client.HTTPResponse(sock, method="GET")
        response.begin()
        body = response.read(max_bytes)
        timings["totalMs"] = round((time.monotonic() - started) * 1000)
        return {**timings, "status": response.status, "body": body}
    except (OSError, http.client.HTTPException) as error:
        raise ProbeError(stage, error, timings) from error
    finally:
        if sock is not None:
            sock.close()


def tcp_connect_ms(addr, port, timeout):
    started = time.monotonic()
    try:
        socket.create_connection((addr, port), timeout=timeout).close()
    except OSError:
        return None
    return round((time.monotonic() - started) * 1000)


def resolve(host, family, timeout):
    infos = bounded(lambda: socket.getaddrinfo(host, 443, family, socket.SOCK_STREAM), timeout)
    seen = []
    for info in infos:
        if info[4][0] not in seen:
            seen.append(info[4][0])
    return seen


def ca_store_state():
    context = ssl.create_default_context()
    loaded = context.cert_store_stats().get("x509_ca", 0)
    paths = ssl.get_default_verify_paths()
    capath_ok = bool(paths.capath and os.path.isdir(paths.capath) and os.listdir(paths.capath))
    return {"loadedCAs": loaded, "capath": capath_ok, "ok": loaded > 0 or capath_ok}


# ---------------------------------------------------------------- the run

class Run:
    def __init__(self, args):
        self.args = args
        self.checks = []
        self.context = ssl.create_default_context()
        self.ca = ca_store_state()
        self.deadline = 0.0

    def step(self, title, budget):
        print(f"\n== {title}", flush=True)
        self.deadline = time.monotonic() + budget

    def add(self, check_id, capability, path, target, outcome, **extra):
        result, code, reason = outcome
        entry = {"id": check_id, "capability": capability, "path": path, "target": target,
                 "result": result, "code": code, "reason": reason}
        entry.update({k: v for k, v in extra.items() if v is not None})
        self.checks.append(entry)
        timing = ""
        if "tlsMs" in extra:
            timing = f" [tcp {extra['tcpMs']} ms, tls {extra['tlsMs']} ms]"
        print(f"{result:<7} {check_id:<5} {target:<46} {reason}{timing}", flush=True)
        return entry

    def out_of_time(self):
        return time.monotonic() > self.deadline

    def https_check(self, check_id, capability, path, target, host, url_path, addr, port, judge,
                    no_route_unknown=False):
        if self.out_of_time():
            return self.add(check_id, capability, path, target, (UNKNOWN, "step-timeout", "step time budget used up"))
        timeout = self.args.timeout
        try:
            answer = bounded(lambda: https_get(host, url_path, addr, port, timeout, self.context), timeout * 3 + 2)
        except ProbeError as failure:
            outcome = classify_error(failure.stage, failure.error, self.ca["ok"])
            if no_route_unknown and outcome[1] == "no-route":  # a machine without IPv6, not a Tono fault
                outcome = (UNKNOWN, "no-route", "this machine has no IPv6 route (clients then use IPv4)")
            return self.add(check_id, capability, path, target, outcome, **failure.timings)
        except TimeoutError:
            return self.add(check_id, capability, path, target, (FAIL, "timeout", "no answer in time"))
        timings = {k: answer[k] for k in ("tcpMs", "tlsMs", "totalMs", "tlsVersion")}
        return self.add(check_id, capability, path, target, judge(answer["status"], answer["body"]),
                        httpStatus=answer["status"], **timings)

    # 1
    def identity(self):
        self.step("1. Network identity (best effort)", 25)
        for source in IDENTITY_SOURCES:
            if self.out_of_time():
                break
            try:
                request = urllib.request.Request(source, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
                with urllib.request.urlopen(request, timeout=self.args.timeout, context=self.context) as response:
                    payload = json.loads(response.read(65536).decode("utf-8"))
                found = parse_identity(source, payload)
            except Exception as error:  # noqa: BLE001 - best effort, any failure means "try the next one"
                print(f"        identity lookup {source} failed: {type(error).__name__}", flush=True)
                continue
            where = ", ".join(str(found[k]) for k in ("city", "region", "country") if found.get(k))
            self.add("1", "identity", "neutral", "public network",
                     (PASS, "identified", f"AS{found['asn']} {found['org']} · {where} · {found['ipPrefix']}"))
            return found
        self.add("1", "identity", "neutral", "public network", (UNKNOWN, "unavailable", "identity lookup blocked or down"))
        return None

    # 2
    def dns(self):
        self.step("2. DNS (system resolver)", 30)
        answers = {}
        for index, host in enumerate((API_HOST, RELEASES_HOST), start=1):
            try:
                addresses = resolve(host, socket.AF_UNSPEC, self.args.timeout)
                outcome = classify_addresses(addresses)
            except TimeoutError:
                addresses, outcome = [], (FAIL, "dns-timeout", "system resolver did not answer in time")
            except OSError as error:
                addresses, outcome = [], classify_error("tcp", error)
            answers[host] = addresses
            self.add(f"2.{index}", "dns", "system_dns", host, outcome, addresses=addresses)
        return answers

    # 3
    def api(self, dns_answers):
        self.step("3. API sign-in paths: TLS + GET /api/v1/health", 120)
        system_v4 = [a for a in dns_answers.get(API_HOST, []) if ":" not in a]
        if system_v4:
            self.https_check("3a", "signin", "system_dns", f"{API_HOST} via system DNS ({system_v4[0]})",
                             API_HOST, HEALTH_PATH, system_v4[0], 443, classify_health)
        else:
            self.add("3a", "signin", "system_dns", f"{API_HOST} via system DNS",
                     (FAIL, "dns", "system DNS gave no IPv4 address"))
        for index, addr in enumerate(PINNED, start=1):
            self.https_check(f"3b.{index}", "signin", "pinned", f"{API_HOST} via pinned {addr}",
                             API_HOST, HEALTH_PATH, addr, 443, classify_health)
        for index, (name, addr, port) in enumerate(RELAYS, start=1):
            self.https_check(f"3c.{index}", "signin", "relay", f"{API_HOST} via relay {name} {addr}:{port}",
                             API_HOST, HEALTH_PATH, addr, port, classify_health)

    # 4
    def updates(self, dns_answers):
        self.step("4. Release host / update discovery: direct and via relays", 120)
        for t_index, (kind, host, url_path) in enumerate(UPDATE_TARGETS, start=1):
            judge = lambda status, body, kind=kind: classify_update(kind, status, body)  # noqa: E731
            direct = [a for a in dns_answers.get(host, []) if ":" not in a]
            entries = []
            if direct:
                entries.append(self.https_check(f"4.{t_index}a", "update", "direct", f"{host}{url_path} direct",
                                                host, url_path, direct[0], 443, judge))
            else:
                entries.append(self.add(f"4.{t_index}a", "update", "direct", f"{host}{url_path} direct",
                                        (FAIL, "dns", "system DNS gave no IPv4 address")))
            for r_index, (name, addr, port) in enumerate(RELAYS, start=1):
                entries.append(self.https_check(f"4.{t_index}r{r_index}", "update", "relay",
                                                f"{host}{url_path} via relay {name}", host, url_path, addr, port, judge))
            statuses = {e.get("httpStatus") for e in entries if e["result"] == PASS}
            if len(statuses) > 1:  # e.g. one path serves the manifest and another says none is published
                for entry in entries:
                    if entry["result"] == PASS:
                        entry.update(result=FAIL, code="inconsistent",
                                     reason=entry["reason"] + f" (paths disagree: HTTP {sorted(statuses)})")
                print(f"FAIL    4.{t_index}   paths disagree on {host}{url_path}: HTTP {sorted(statuses)}", flush=True)

    # 5
    def exits(self):
        nodes = list(NODES) + [(name, addr, None, "--node") for name, addr in self.args.node]
        self.step("5. Exit nodes: TCP to the Reality port; hy2 handshake if a test credential is given",
                  60 + len(nodes) * self.args.count * (self.args.timeout + 1))
        control = tcp_connect_ms(*TCP_CONTROL, timeout=3)
        intercepted = control is not None
        self.add("5.0", "exit", "control", f"TCP control {TCP_CONTROL[0]}:{TCP_CONTROL[1]} (never routed)",
                 (UNKNOWN, "tcp-intercepted", "connect succeeded: this network proxies all TCP, step 5 TCP is not measurable")
                 if intercepted else (PASS, "no-interception", "no answer, as expected: TCP results are real"))
        for index, (name, addr, _fp, source) in enumerate(nodes, start=1):
            if self.out_of_time():
                self.add(f"5.{index}", "exit.reality", "direct", f"{name} {addr}:{REALITY_PORT}",
                         (UNKNOWN, "step-timeout", "step time budget used up"))
                continue
            samples = []
            for _ in range(self.args.count):
                samples.append(tcp_connect_ms(addr, REALITY_PORT, self.args.timeout))
                time.sleep(0.3)
            self.add(f"5.{index}", "exit.reality", "direct", f"{name} {addr}:{REALITY_PORT}",
                     classify_tcp_series(samples, intercepted), node=name, source=source, connectMs=samples)
        self.hy2()

    def hy2(self):
        args = self.args
        if not args.hy2_auth_file:
            self.add("5.h", "exit.hy2", "direct", "hy2 handshake", (UNKNOWN, "not-run", "not run: no --hy2-auth-file"))
            return
        probe = args.hy2_probe
        hysteria = args.hysteria or shutil.which("hysteria")
        missing = ("hy2_probe.py not found (--hy2-probe)" if not os.path.isfile(probe)
                   else "hysteria client not found (--hysteria)" if not hysteria or not os.path.exists(hysteria)
                   else "no --hy2-cert-dir" if not args.hy2_cert_dir else None)
        for index, (name, addr, fingerprint, _source) in enumerate(n for n in NODES if n[2]):
            target = f"{name} {addr}:443/udp hy2"
            cert = os.path.join(args.hy2_cert_dir or "", f"{addr}.pem")
            if missing or not os.path.isfile(cert):
                self.add(f"5.h{index + 1}", "exit.hy2", "direct", target,
                         (UNKNOWN, "not-run", f"not run: {missing or 'no ' + addr + '.pem in --hy2-cert-dir'}"))
                continue
            command = [sys.executable, probe, "--hysteria", hysteria, "--server", f"{addr}:443", "--sni", HY2_SNI,
                       "--cert", cert, "--fingerprint", fingerprint, "--auth-file", args.hy2_auth_file,
                       "--count", "3", "--timeout", str(args.timeout + 5), "--carrier", args.carrier,
                       "--vantage", args.label]
            try:
                run = subprocess.run(command, capture_output=True, text=True, timeout=3 * (args.timeout + 7) + 15)
                outcome = classify_hy2(run.stdout, run.returncode)
                said = (run.stderr or "").strip().splitlines()[-1:]
                if outcome[1] == "hy2-setup" and said and said[0].startswith("hy2_probe:"):
                    outcome = (outcome[0], outcome[1], said[0][:160])  # its own fixed messages, never the secret
            except subprocess.TimeoutExpired:
                outcome = (FAIL, "hy2-timeout", "hy2_probe.py did not finish in time")
            self.add(f"5.h{index + 1}", "exit.hy2", "direct", target, outcome, node=name)

    # 6
    def ipv6(self):
        self.step("6. IPv6", 40)
        try:
            v6 = [a for a in resolve(API_HOST, socket.AF_INET6, self.args.timeout) if ":" in a]
        except (OSError, TimeoutError):
            v6 = []
        if not v6:
            self.add("6.1", "ipv6", "system_dns", f"{API_HOST} AAAA",
                     (UNKNOWN, "no-aaaa", "no AAAA answer (resolver filters AAAA or no IPv6)"))
            return
        result, code, reason = classify_addresses(v6)
        self.add("6.1", "ipv6", "system_dns", f"{API_HOST} AAAA", (result, code, reason), addresses=v6)
        self.https_check("6.2", "ipv6", "system_dns", f"{API_HOST} via IPv6 [{v6[0]}]",
                         API_HOST, HEALTH_PATH, v6[0], 443, classify_health, no_route_unknown=True)

    def summary(self, identity):
        def picks(capability):
            return [(c["path"], c["result"]) for c in self.checks
                    if c["capability"] == capability and c["path"] != "control"]

        reality = [c for c in self.checks if c["capability"] == "exit.reality"]
        hy2 = [c for c in self.checks if c["capability"] == "exit.hy2" and c["code"] != "not-run"]
        country = (identity or {}).get("country")
        return {
            "signIn": customer_verdict(picks("signin")),
            "update": customer_verdict(picks("update")),
            "realityPorts": f"{sum(c['result'] == PASS for c in reality)}/{len(reality)} PASS"
                            + (", TCP intercepted: unknown" if any(c["code"] == "tcp-intercepted" for c in reality) else ""),
            "hy2": f"{sum(c['result'] == PASS for c in hy2)}/{len(hy2)} PASS" if hy2 else "not run",
            "dnsPoisoned": any(c["capability"] == "dns" and c["code"] == "not-cloudflare" for c in self.checks),
            "ipv6": next((c["result"] for c in self.checks if c["id"] == "6.2"), "UNKNOWN"),
            "mainlandChinaVantage": None if not country else country == "CN",
        }


def script_sha256():
    with open(os.path.abspath(__file__), "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def print_matrix(checks, verdicts):
    print("\n== Matrix (capability × path)")
    print(f"{'capability':<13} {'path':<11} {'result':<8} {'id':<6} target")
    for c in checks:
        print(f"{c['capability']:<13} {c['path']:<11} {c['result']:<8} {c['id']:<6} {c['target']}")
    print("\n== For customers")
    for key, value in verdicts.items():
        print(f"  {key}: {value}")


def main(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--label", default="", help="vantage, e.g. '上海 移动 家宽' (city + access type only)")
    parser.add_argument("--carrier", choices=("cmcc", "ct", "cu", "other"), default="other")
    parser.add_argument("--out", default="", help="summary JSON path (default ./tono-cn-acceptance-<UTC>.json)")
    parser.add_argument("--timeout", type=float, default=8.0, help="seconds per connect / handshake / answer")
    parser.add_argument("--count", type=int, default=3, help="TCP connects per Reality port")
    parser.add_argument("--node", action="append", default=[], type=lambda s: tuple(s.rsplit("=", 1)),
                        metavar="NAME=IPv4", help="extra exit node to TCP-check (public IP only)")
    parser.add_argument("--hy2-auth-file", default="", help="0600 file with a test account UUID (never read here)")
    parser.add_argument("--hy2-cert-dir", default="", help="directory with <node-ip>.pem public leaf certificates")
    parser.add_argument("--hysteria", default="", help="official hysteria v2 client binary")
    parser.add_argument("--hy2-probe", default=os.path.join(here, "..", "hy2", "hy2_probe.py"))
    args = parser.parse_args(argv)
    for pair in args.node:
        try:
            ipaddress.IPv4Address(pair[1] if len(pair) == 2 else "")
        except ValueError:
            parser.error(f"--node wants NAME=IPv4, got {'='.join(pair)!r}")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")

    started = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)
    run = Run(args)
    print(f"Tono CN acceptance · {started.isoformat()} · label: {args.label or '(none)'} · carrier: {args.carrier}")
    print(f"Python {platform.python_version()} on {platform.system()} {platform.release()}; "
          f"CA store {'ok' if run.ca['ok'] else 'EMPTY'}")
    if not run.ca["ok"]:
        print("WARNING: this Python has no CA certificates; TLS checks will be UNKNOWN. On macOS run "
              "'/Applications/Python 3.x/Install Certificates.command' once, then run this again.")

    identity = run.identity()
    if identity and identity.get("country") and identity["country"] != "CN":
        print(f"NOTE: this vantage is in {identity['country']}, not mainland China: results are NOT China field evidence.")
    answers = run.dns()
    run.api(answers)
    run.updates(answers)
    run.exits()
    run.ipv6()

    verdicts = run.summary(identity)
    print_matrix(run.checks, verdicts)
    summary = {
        "schema": SCHEMA,
        "at": started.isoformat(),
        "finishedAt": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "label": args.label, "carrier": args.carrier,
        "tool": {"sha256": script_sha256(), "python": platform.python_version(),
                 "os": f"{platform.system()} {platform.release()}", "caStore": run.ca},
        "identity": identity,
        "credentialsIncluded": False,
        "hy2AuthFileGiven": bool(args.hy2_auth_file),
        "customer": verdicts,
        "counts": {r: sum(c["result"] == r for c in run.checks) for r in (PASS, FAIL, UNKNOWN)},
        "checks": run.checks,
    }
    out = args.out or f"tono-cn-acceptance-{started.strftime('%Y%m%dT%H%M%SZ')}.json"
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=1)
        handle.write("\n")
    print(f"\nSummary saved: {os.path.abspath(out)}  (send this file back; it has no credential or full IP)")
    return 2 if summary["counts"][FAIL] else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
