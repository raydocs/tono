#!/bin/sh
set -eu

# Reports which addresses WeChat actually dialed and whether each one reached
# the China-direct route or fell through to the tunnel.
#
# Why this exists: WeChat's main message channel resolves through its own
# HTTPDNS and dials raw IPs, so the policy's DOMAIN rules cannot match it — only
# an exact `tcpEndpoints` entry can. Tencent rotates those access addresses per
# region, so an address list gathered anywhere else does not transfer. This
# reads the local audit log the app already writes; it needs no root, no packet
# capture, and sends nothing anywhere.
#
# Run it after using WeChat for a few minutes with Tono connected, then send the
# output back.

log_directory="$HOME/Library/Application Support/Tono/Logs"
if [ ! -d "$log_directory" ]; then
    echo "No Tono log directory found. Connect Tono, use WeChat briefly, then re-run." >&2
    exit 1
fi

/usr/bin/python3 - "$log_directory" <<'PY'
import collections
import json
import pathlib
import re
import sys

directory = pathlib.Path(sys.argv[1])
files = sorted(directory.glob("traffic-audit.jsonl*"))
if not files:
    print("No audit log yet. Connect Tono, use WeChat briefly, then re-run.")
    raise SystemExit(1)

address = re.compile(r"^\d+\.\d+\.\d+\.\d+$")
tunnelled = collections.Counter()
direct = collections.Counter()
bytes_by_endpoint = collections.Counter()
literal_dials = 0
named_dials = 0

for path in files:
    try:
        text = path.read_text(errors="replace")
    except OSError:
        continue
    for line in text.splitlines():
        if '"connection_id"' not in line or "WeChat" not in line:
            continue
        try:
            record = json.loads(line)
        except ValueError:
            continue
        if (record.get("process") or "") != "WeChat":
            continue
        host = (record.get("host") or "").strip()
        destination = (record.get("destination_ip") or "").strip()
        port = record.get("destination_port")
        route = record.get("route") or ""
        target = destination or host
        if not target or not address.match(target):
            named_dials += 1
            continue
        literal_dials += 1
        key = (target, port)
        if "Direct" in route:
            direct[key] += 1
        else:
            tunnelled[key] += 1

print("WeChat dials seen in this log")
print(f"  raw-address dials : {literal_dials}")
print(f"  hostname dials    : {named_dials}")
print()

if not tunnelled:
    print("Every raw-address dial already took the direct route — nothing to add.")
else:
    print("Addresses that fell through to the tunnel (candidates for the policy):")
    for (target, port), count in tunnelled.most_common():
        print(f"  {target:<16} port {str(port):<6} {count:4d} connections")
    print()
    print("JSON fragment for the policy's tcpEndpoints:")
    grouped = collections.defaultdict(set)
    for (target, port), _ in tunnelled.items():
        if isinstance(port, int) and port in (80, 443):
            grouped[target].add(port)
    entries = [
        {"address": target, "ports": sorted(ports)}
        for target, ports in sorted(grouped.items())
    ]
    print(json.dumps(entries, indent=2))
    skipped = {
        port
        for (_, port) in tunnelled
        if not (isinstance(port, int) and port in (80, 443))
    }
    if skipped:
        print()
        print(f"Ports the policy cannot express, so they are left out: {sorted(skipped)}")

if direct:
    print()
    print("Already routed direct (for reference):")
    for (target, port), count in direct.most_common(10):
        print(f"  {target:<16} port {str(port):<6} {count:4d} connections")
PY
