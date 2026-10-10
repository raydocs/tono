#!/usr/bin/env python3
"""Measure an hy2 node from mainland China carriers through the public Globalping API.

No account, token or node access is needed. For one target IPv4 this creates four
measurements on the same probes (per carrier, `--per-carrier` probes from China Mobile
AS9808, China Telecom AS4134 and China Unicom AS4837):

  1. ICMP ping                       -> latency / loss to the host
  2. TCP ping to 443                 -> the VLESS Reality baseline (connect only, no data)
  3. mtr UDP to the hy2 port         -> how far a UDP datagram to that port travels
  4. mtr UDP to a closed control port -> whether UDP datagrams are delivered to the host

What this does NOT prove: a QUIC / Hysteria2 handshake. The mtr payload is not QUIC,
so a censor that classifies QUIC Initials (SNI, Hysteria fingerprints) is not exercised,
and the hy2 server silently drops it, so the target itself never answers on the hy2
port. Use hy2_probe.py from a vantage machine for the real handshake.

Unauthenticated Globalping allows 250 tests per hour; one target costs
4 * 3 * per_carrier tests (36 by default).

  python3 globalping_carriers.py --target 23.94.79.123 --label "Buffalo · Niagara" --out /tmp/niagara.json
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import sys
import time
import urllib.error
import urllib.request

API = "https://api.globalping.io/v1/measurements"
USER_AGENT = "tono-ops-hy2-carrier-probe/1 (+https://github.com/raydocs/tono)"

CARRIERS = (("China Mobile", 9808), ("China Telecom", 4134), ("China Unicom", 4837))

# Chinese carrier ASNs, domestic and their international arms (CMI 58453, CN2 4809,
# CUG 10099, CTG 23764). A responding hop outside this set means the datagram left the
# Chinese carriers' networks, i.e. it passed the border where filtering happens.
CHINESE_ASNS = frozenset({
    4134, 4809, 4812, 4813, 4816, 4835, 23764, 134773, 136188,  # China Telecom
    4808, 4837, 9929, 10099, 17621, 17622, 17623, 17816, 135061,  # China Unicom
    9808, 24400, 24445, 56040, 56041, 56042, 56044, 56046, 56047, 56048, 58453, 58807,  # China Mobile
})


def _request(url: str, body: dict | None = None) -> dict:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST" if body is not None else "GET")
    req.add_header("User-Agent", USER_AGENT)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def create(kind: str, target: str, locations, options: dict) -> str:
    body = {"type": kind, "target": target, "locations": locations, "measurementOptions": options}
    return _request(API, body)["id"]


def wait(measurement_id: str, deadline_s: float = 90.0) -> dict:
    end = time.monotonic() + deadline_s
    while True:
        time.sleep(2.0)  # Globalping asks for <= 2 GETs per second per measurement.
        result = _request(f"{API}/{measurement_id}")
        if result.get("status") != "in-progress" or time.monotonic() > end:
            return result


def _asn(hop: dict | None) -> int | None:
    asns = (hop or {}).get("asn") or []
    return asns[0] if asns else None


def udp_path(hops: list[dict], target: str) -> dict:
    """Classify how far a UDP datagram got from the hops of one mtr result."""
    answered = [h for h in hops if (h.get("stats") or {}).get("rcv")]
    if not answered:
        return {"verdict": "no-reply", "lastHop": None, "lastHopName": None, "lastHopAsn": None,
                "lastHopMs": None, "preTargetAsn": None}
    last = answered[-1]
    known = [a for h in answered for a in (h.get("asn") or [])]
    before_target = [h for h in answered if h.get("resolvedAddress") != target]
    if last.get("resolvedAddress") == target:
        verdict = "target-replied"
    elif not ipaddress.ip_address(last.get("resolvedAddress") or "0.0.0.0").is_global:
        verdict = "probe-lan"  # the probe's own network stops answering; says nothing about the path
    elif any(a not in CHINESE_ASNS for a in known):
        verdict = "left-china"
    elif known:
        verdict = "cn-only"
    else:
        verdict = "unclassified"
    return {
        "verdict": verdict,
        "lastHop": last.get("resolvedAddress"),
        "lastHopName": last.get("resolvedHostname"),
        "lastHopAsn": _asn(last),
        "lastHopMs": (last.get("stats") or {}).get("avg"),
        "preTargetAsn": _asn(before_target[-1]) if before_target and verdict == "target-replied" else None,
    }


def _same_24(a: str | None, b: str) -> bool:
    return bool(a) and a.rsplit(".", 1)[0] == b.rsplit(".", 1)[0]


def hy2_edge(hy2: dict, control: dict | None, target: str) -> dict:
    """Upgrade the hy2-port path to host-edge when it stops right in front of the host.

    The hy2 server drops non-QUIC datagrams without an answer, so the deepest a UDP mtr to
    the hy2 port can show is the router in front of the host. That router is either in the
    host's /24 (its gateway), or in the network that the control-port mtr from the same
    probe, which the host answers, shows directly before the host.
    """
    if hy2["verdict"] not in ("left-china", "cn-only", "unclassified"):
        return hy2
    same_handoff = (control and control["verdict"] == "target-replied" and control["preTargetAsn"] is not None
                    and hy2["lastHopAsn"] == control["preTargetAsn"])
    if same_handoff or _same_24(hy2["lastHop"], target):
        return {**hy2, "verdict": "host-edge"}
    return hy2


def _probe_key(probe: dict) -> str:
    return json.dumps(probe, sort_keys=True)


def summarize(target: str, measurements: dict[str, dict]) -> list[dict]:
    rows: dict[str, dict] = {}
    for kind, measurement in measurements.items():
        seen: dict[str, int] = {}
        for result in measurement.get("results", []):
            probe = result["probe"]
            key = _probe_key(probe)
            seen[key] = seen.get(key, 0) + 1
            key = f"{key}#{seen[key]}"
            row = rows.setdefault(key, {
                "city": probe.get("city"),
                "asn": probe.get("asn"),
                "network": probe.get("network"),
                "carrier": next((name for name, asn in CARRIERS if asn == probe.get("asn")), "?"),
            })
            res = result.get("result", {})
            if kind in ("icmp", "tcp443"):
                stats = res.get("stats") or {}
                row[kind] = {"minMs": stats.get("min"), "avgMs": stats.get("avg"), "loss": stats.get("loss"),
                             "status": res.get("status")}
            else:
                row[kind] = udp_path(res.get("hops") or [], target)
    for row in rows.values():
        if "udpHy2" in row:
            row["udpHy2"] = hy2_edge(row["udpHy2"], row.get("udpControl"), target)
    order = {name: i for i, (name, _) in enumerate(CARRIERS)}
    return sorted(rows.values(), key=lambda r: (order.get(r["carrier"], 9), r["city"] or ""))


def _fmt_ping(value: dict | None) -> str:
    if not value or value.get("avgMs") is None:
        return "no reply" if value else "—"
    return f"{value['minMs']:.0f} / {value['avgMs']:.0f} ms, {value['loss']:.0f}%"


def _fmt_udp(value: dict | None) -> str:
    if not value:
        return "—"
    if value["verdict"] == "no-reply":
        return "no-reply"
    asn = "AS?" if value["lastHopAsn"] is None else f"AS{value['lastHopAsn']}"
    ms = "" if value["lastHopMs"] is None else f" {value['lastHopMs']:.0f} ms"
    return f"{value['verdict']} ({asn}{ms})"


def markdown(label: str, rows: list[dict]) -> str:
    lines = [
        "| Node | Carrier | Probe | ICMP min / avg, loss | TCP 443 min / avg, loss | UDP hy2 port path | UDP control port |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| {label} | {r['carrier']} | {r['city']} AS{r['asn']} | {_fmt_ping(r.get('icmp'))} | "
            f"{_fmt_ping(r.get('tcp443'))} | {_fmt_udp(r.get('udpHy2'))} | {_fmt_udp(r.get('udpControl'))} |"
        )
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--target", required=True, help="node IPv4 (public, already in docs)")
    parser.add_argument("--label", required=True, help="catalog base name, for the table")
    parser.add_argument("--hy2-port", type=int, default=443)
    parser.add_argument("--control-port", type=int, default=33434, help="a UDP port nothing listens on")
    parser.add_argument("--per-carrier", type=int, default=3)
    parser.add_argument("--out", help="write measurement ids and the summary as JSON here")
    parser.add_argument("--ids", help="re-read the measurement ids of an earlier --out file (no new tests)")
    args = parser.parse_args(argv)

    locations = [{"country": "CN", "asn": asn, "limit": args.per_carrier} for _, asn in CARRIERS]
    try:
        if args.ids:
            with open(args.ids, encoding="utf-8") as fh:
                ids = json.load(fh)["measurementIds"]
        else:
            first = create("ping", args.target, locations, {"packets": 5})
            udp = {"packets": 3, "protocol": "UDP"}
            ids = {
                "icmp": first,
                "tcp443": create("ping", args.target, first, {"packets": 5, "protocol": "TCP", "port": 443}),
                "udpHy2": create("mtr", args.target, first, {**udp, "port": args.hy2_port}),
                "udpControl": create("mtr", args.target, first, {**udp, "port": args.control_port}),
            }
        measurements = {kind: wait(mid) for kind, mid in ids.items()}
    except urllib.error.HTTPError as err:
        print(f"globalping: HTTP {err.code} {err.read()[:300]!r}", file=sys.stderr)
        return 1

    rows = summarize(args.target, measurements)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"target": args.target, "label": args.label, "hy2Port": args.hy2_port,
                       "controlPort": args.control_port, "measurementIds": ids, "rows": rows},
                      fh, ensure_ascii=False, indent=2)
    print(markdown(args.label, rows))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
