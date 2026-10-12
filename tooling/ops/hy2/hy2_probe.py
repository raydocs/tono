#!/usr/bin/env python3
"""Real Hysteria2 handshake check from a node or a vantage machine, reported without secrets.

Runs the official `hysteria` client's `ping` mode N times against one hy2 node. Each
attempt is a full QUIC + TLS + Hysteria2 auth handshake ("connected to server"),
then one TCP connect through the tunnel to --target ("connected"). That is what the
Globalping carrier table (globalping_carriers.py) cannot show.

Trust: the client verifies the node with --cert used as its only CA (insecure: false).
Before running, this script checks that --cert hashes to --fingerprint, the catalog
`fingerprint` of the node's ` · hy2` block, so a wrong or swapped certificate is refused.
The node's leaf is public: /opt/tono-hy2/current/cert.pem (or /opt/tono-hy2/tls/cert.pem
on the September Dedirock installs).

Auth: --auth-file holds the UUID of a dedicated, entitled test account (the hy2
allowlist only accepts roster UUIDs; the old shared probe password is gone). The file
must be owned by you and mode 0600. The value is written only to a 0600 temp config,
never printed, and is scrubbed from any client output this script keeps.

  python3 hy2_probe.py --hysteria ./hysteria --server 23.94.79.123:443 \\
    --sni www.microsoft.com --cert niagara.pem \\
    --fingerprint 1e5374a79bdb83b04c3d3c84722c03211d1c941c2de9f92431d2198ba7212cad \\
    --auth-file ~/.tono-hy2-probe --vantage "Shanghai home" --carrier cmcc --markdown

Prints one JSON object (schema tono.hy2-probe.v1); with --markdown also one table row
for docs/ops/transport-hy2.md. Exit 0 when every attempt passed, 2 when any failed,
1 on a setup error (nothing was sent).
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import ssl
import statistics
import subprocess
import sys
import tempfile
import time

ANSI = re.compile(r"\x1b\[[0-9;]*m")
GO_DURATION = re.compile(r"([0-9.]+)(ns|us|µs|ms|s|m|h)")
UNIT_MS = {"ns": 1e-6, "us": 1e-3, "µs": 1e-3, "ms": 1.0, "s": 1e3, "m": 6e4, "h": 3.6e6}
CARRIERS = ("cmcc", "ct", "cu", "node", "other")


def go_duration_ms(text: str) -> float | None:
    parts = GO_DURATION.findall(text or "")
    if not parts:
        return None
    return round(sum(float(n) * UNIT_MS[u] for n, u in parts), 1)


def _keep_string_values(pairs):
    # hysteria's JSON log has two "time" keys on the "connected" line: the epoch-ms
    # timestamp and the duration string. Keep the duration whatever the key order.
    entry: dict = {}
    for key, value in pairs:
        if not (key in entry and isinstance(entry[key], str) and not isinstance(value, str)):
            entry[key] = value
    return entry


def _log_entries(output: str):
    """Yield (msg, fields) from hysteria JSON or console log lines."""
    for raw in output.splitlines():
        line = ANSI.sub("", raw).strip()
        if not line:
            continue
        try:
            entry = json.loads(line, object_pairs_hook=_keep_string_values)
            if isinstance(entry, dict):
                yield str(entry.get("msg", "")), entry
                continue
        except ValueError:
            pass
        parts = line.split("\t")
        if len(parts) >= 3:
            fields = {}
            if len(parts) >= 4 and parts[3].startswith("{"):
                try:
                    fields = json.loads(parts[3])
                except ValueError:
                    fields = {}
            yield parts[2].strip(), fields


def classify_error(text: str) -> str:
    low = text.lower()
    if "auth" in low:
        return "auth-rejected"
    if "x509" in low or "certificate" in low or "tls:" in low or "crypto_error" in low:
        return "tls"
    if "timeout" in low or "no recent network activity" in low or "deadline" in low:
        return "timeout"
    return "handshake"


def parse_ping_output(output: str, returncode: int) -> dict:
    """Read one `hysteria ping` run: did the hy2 handshake pass, and how long the tunnelled connect took."""
    handshake = False
    connect_ms = None
    error = None
    for msg, fields in _log_entries(output):
        if msg == "connected to server":
            handshake = True
        elif msg == "connected":
            connect_ms = go_duration_ms(str(fields.get("time", "")))
        elif msg.startswith("failed") and error is None:  # "failed to initialize client" / "failed to connect"
            error = (msg, str(fields.get("error", "")))
    ok = handshake and connect_ms is not None and returncode == 0
    if ok:
        failure = None
    elif handshake:
        failure = "proxy-connect"  # hy2 is up; only the onward TCP connect through it failed
    elif error:
        failure = classify_error(error[1] or error[0])
    else:
        failure = "no-output" if not output.strip() else "handshake"
    return {"handshake": handshake, "ok": ok, "connectMs": connect_ms, "failure": failure,
            "detail": (error[1] if error else "")[:200]}


def _normalized_fingerprint(value: str) -> str:
    fp = value.replace(":", "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", fp):
        raise SystemExit("hy2_probe: --fingerprint must be 64 hex characters (SHA-256 of the leaf)")
    return fp


def _read_auth(path: str) -> str:
    st = os.stat(path)
    if not os.path.isfile(path) or st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise SystemExit("hy2_probe: --auth-file must be a regular file you own with mode 0600")
    with open(path, encoding="utf-8") as fh:
        secret = fh.read().strip()
    if not secret:
        raise SystemExit("hy2_probe: --auth-file is empty")
    return secret


def _hysteria_version(binary: str) -> str:
    try:
        out = subprocess.run([binary, "version"], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return "unknown"
    match = re.search(r"Version:\s*(\S+)", ANSI.sub("", out))
    return match.group(1) if match else "unknown"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hysteria", default=shutil.which("hysteria") or "hysteria", help="official hysteria v2 client")
    parser.add_argument("--server", required=True, help="IPv4:port of the hy2 block")
    parser.add_argument("--sni", required=True, help="catalog sni of the hy2 block")
    parser.add_argument("--cert", required=True, help="the node's public leaf certificate (PEM)")
    parser.add_argument("--fingerprint", required=True, help="catalog fingerprint (SHA-256 of the leaf)")
    parser.add_argument("--auth-file", required=True, help="0600 file with a test account UUID")
    parser.add_argument("--target", default="1.1.1.1:443", help="address to TCP-connect through the tunnel")
    parser.add_argument("--count", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=20.0, help="seconds per attempt")
    parser.add_argument("--vantage", default="", help="free text: city / access type, no personal data")
    parser.add_argument("--carrier", choices=CARRIERS, default="other")
    parser.add_argument("--markdown", action="store_true", help="also print one table row")
    args = parser.parse_args(argv)

    fingerprint = _normalized_fingerprint(args.fingerprint)
    with open(args.cert, encoding="ascii") as fh:
        pem = fh.read()
    if hashlib.sha256(ssl.PEM_cert_to_DER_cert(pem)).hexdigest() != fingerprint:
        print("hy2_probe: --cert does not match --fingerprint; refusing to probe", file=sys.stderr)
        return 1
    secret = _read_auth(args.auth_file)

    workdir = tempfile.mkdtemp(prefix="tono-hy2-probe-")  # mode 0700
    attempts = []
    try:
        ca = os.path.join(workdir, "ca.pem")
        with open(ca, "w", encoding="ascii") as fh:
            fh.write(pem)
        config = os.path.join(workdir, "client.yaml")
        fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            # JSON strings are valid YAML scalars, so no value can break the document.
            fh.write(f"server: {json.dumps(args.server)}\nauth: {json.dumps(secret)}\n"
                     f"tls:\n  sni: {json.dumps(args.sni)}\n  ca: {json.dumps(ca)}\n  insecure: false\n")
        env = {**os.environ, "HYSTERIA_LOG_FORMAT": "json", "HYSTERIA_LOG_LEVEL": "info",
               "HYSTERIA_DISABLE_UPDATE_CHECK": "1"}
        for _ in range(max(1, args.count)):
            started = time.monotonic()
            try:
                run = subprocess.run([args.hysteria, "ping", args.target, "-c", config], capture_output=True,
                                     text=True, timeout=args.timeout, env=env)
                output, code = run.stdout + run.stderr, run.returncode
            except subprocess.TimeoutExpired as exc:
                output = "".join(p.decode(errors="replace") if isinstance(p, bytes) else p
                                 for p in (exc.stdout or "", exc.stderr or ""))
                code = -1
            result = parse_ping_output(output.replace(secret, "[redacted]"), code)
            if code == -1 and not result["handshake"]:
                result["failure"] = "timeout"
            result["wallMs"] = round((time.monotonic() - started) * 1000, 1)
            attempts.append(result)
            time.sleep(1.0)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    ok = [a for a in attempts if a["ok"]]
    times = [a["connectMs"] for a in ok if a["connectMs"] is not None]
    failures: dict[str, int] = {}
    for a in attempts:
        if a["failure"]:
            failures[a["failure"]] = failures.get(a["failure"], 0) + 1
    verdict = "ok" if len(ok) == len(attempts) else ("partial" if ok else "blocked")
    report = {
        "schema": "tono.hy2-probe.v1",
        "at": datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(),
        "vantage": args.vantage, "carrier": args.carrier, "server": args.server, "sni": args.sni,
        "fingerprint": fingerprint, "target": args.target, "hysteriaVersion": _hysteria_version(args.hysteria),
        "attempts": len(attempts), "handshakeOk": sum(a["handshake"] for a in attempts), "ok": len(ok),
        "connectMs": ({"min": min(times), "median": statistics.median(times), "max": max(times)} if times else None),
        "failures": failures, "verdict": verdict,
        "details": sorted({a["detail"] for a in attempts if a["detail"]})[:3],
    }
    print(json.dumps(report, ensure_ascii=False))
    if args.markdown:
        ms = report["connectMs"]
        latency = f"{ms['min']:.0f} / {ms['median']:.0f} / {ms['max']:.0f} ms" if ms else "—"
        print(f"| {report['at'][:10]} | {args.carrier} | {args.vantage} | {args.server} | "
              f"{report['handshakeOk']}/{len(attempts)} | {latency} | {verdict} "
              f"{json.dumps(failures) if failures else ''} | {report['hysteriaVersion']} |")
    return 0 if verdict == "ok" else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
