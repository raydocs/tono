#!/usr/bin/env python3
"""Offline B3 export: preserve failed streams and raw CPU; never pool events as requests."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import statistics


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def distribution(values):
    values = sorted(values)
    if not values:
        return {"n": 0}
    return {"n": len(values), "min": values[0], "p50": statistics.median(values),
            "p95": values[math.ceil(.95 * len(values)) - 1], "max": values[-1]}


def stream_record(sample, expected, identity):
    events = sample.get("events", [])
    row = dict(identity, **{k: v for k, v in sample.items() if k != "events"})
    row.update(expected_events=expected, received_events=len(events),
               payload_bytes=sum(e["bytes"] for e in events),
               complete=sample.get("status") == "PASS" and sample.get("done", False) and len(events) == expected)
    for label, key in [("arrival_gap_ms", "client_arrival_ms"), ("emission_gap_ms", "server_emit_ms")]:
        gaps = [b[key] - a[key] for a, b in zip(events, events[1:])]
        row.update({f"{label}_{k}": v for k, v in distribution(gaps).items()})
    row["max_active_handlers"] = max((e["active"] for e in events), default=0)
    return row


def cpu_ms(case, ticks, role="client"):
    resources = case["resources"]
    return (resources["after"][role]["cpu_ticks"] - resources["before"][role]["cpu_ticks"]) * 1000 / ticks


def export_run(value):
    ticks = value["clock_ticks_per_second"]
    diagnostic = value["mode"] == "profile"
    idles = {c["candidate"]: c for c in value.get("cases", []) if c["case"] == "idle" and c["status"] == "PASS"}
    cases, streams = [], []
    for case in value.get("cases", []):
        identity = {"run_id": value["run_id"], "batch": value["batch"], "candidate": case["candidate"],
                    "case": case["case"], "diagnostic": diagnostic}
        samples = case.get("samples", [])
        rows = [stream_record(s, case.get("expected_events"), identity) for s in samples]
        streams.extend(rows)
        row = dict(identity, status=case["status"], requested_streams=case.get("concurrency", 0),
                   recorded_streams=len(rows), missing_streams=max(0, case.get("concurrency", 0)-len(rows)),
                   complete_streams=sum(s["complete"] for s in rows),
                   timeout_streams=sum(s["status"] == "TIMEOUT" for s in rows),
                   failed_streams=sum(s["status"] not in ["PASS", "CANCELLED"] for s in rows),
                   event_count=sum(s["received_events"] for s in rows),
                   payload_bytes=sum(s["payload_bytes"] for s in rows),
                   response_body_bytes=sum(s.get("response_body_bytes", 0) for s in rows),
                   stream_seconds=sum(s["elapsed_ms"] for s in rows)/1000,
                   window_ms=case["resources"]["window_ms"])
        row["cancel_verified"] = case.get("cancel_verified")
        for role in ["client", "server", "fixture"]:
            row[f"{role}_cpu_ms"] = cpu_ms(case, ticks, role)
            resources = case["resources"]
            observations = [resources["before"], resources["after"], *resources["samples_250ms"]]
            row[f"{role}_rss_max_kib"] = max(o[role]["rss_kib"] for o in observations)
        idle = idles.get(case["candidate"])
        row["client_idle_adjusted_cpu_ms"] = (row["client_cpu_ms"] - cpu_ms(idle, ticks) * row["window_ms"] / idle["resources"]["window_ms"]) if idle else None
        for name, denominator in [("stream_second", row["stream_seconds"]), ("event", row["event_count"]),
                                  ("payload_mib", row["payload_bytes"]/(1 << 20))]:
            for prefix in ["client", "client_idle_adjusted"]:
                numerator = row[prefix+"_cpu_ms"]
                row[f"{prefix}_cpu_ms_per_{name}"] = numerator / denominator if denominator and numerator is not None else None
        cases.append(row)
    return cases, streams


def compact(value):
    """Retain protocol, warmup, errors, CPU endpoints and profile hashes, not large timelines."""
    if isinstance(value, list):
        return [compact(v) for v in value]
    if not isinstance(value, dict):
        return value
    return {k: compact(v) for k, v in value.items() if k not in ["events", "samples_250ms"]}


def csv_file(path, rows):
    fields = list(dict.fromkeys(k for row in rows for k in row))
    with path.open("w", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("runs", nargs="+", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    cases, streams, provenance = [], [], []
    for root in args.runs:
        path = root / "results.json"
        value = json.loads(path.read_text())
        c, s = export_run(value)
        cases.extend(c)
        streams.extend(s)
        provenance.append({"run_id": value["run_id"], "files": [
            {"path": str(p), "sha256": sha(p), "bytes": p.stat().st_size}
            for p in [path, root/"execution.json", root/"cleanup.json", root/"host-network.json"]]})
        published = compact(value)
        published["cleanup"] = json.loads((root/"cleanup.json").read_text())
        published["host_network_unchanged"] = json.loads((root/"host-network.json").read_text())["unchanged"]
        (args.output/(root.name+".json")).write_text(json.dumps(published, indent=2)+"\n")
    csv_file(args.output/"cases.csv", cases)
    csv_file(args.output/"streams.csv", streams)
    (args.output/"provenance.json").write_text(json.dumps(provenance, indent=2)+"\n")
    print(f"Exported {len(cases)} cases, {len(streams)} streams; failures retained.")


if __name__ == "__main__":
    main()
