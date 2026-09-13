#!/usr/bin/env python3
"""Offline, bounded B2 result export. Never read credentials, config files or logs."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import statistics

from batch import HY2_CASES, KINDS, REALITY_CASES


def percentile(values, fraction):
    if not values:
        return None
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)]


def distribution(values):
    # Nearest-rank p95 is descriptive; omit it for fewer than 20 observations.
    return {"observed": len(values), "p50": statistics.median(values) if values else None,
            "p95": percentile(values, .95) if len(values) >= 20 else None,
            "min": min(values) if values else None, "max": max(values) if values else None}


def case_summary(case, expected, hz):
    samples = case.get("samples", [])
    passed = sum(s["status"] == "PASS" for s in samples)
    missing = max(0, expected - len(samples))
    row = {"expected": expected, "emitted": len(samples), "passed": passed,
           "failed": len(samples) - passed, "timeouts": sum(s["status"] == "TIMEOUT" for s in samples),
           "missing": missing, "success_rate": passed / expected,
           "elapsed_ms": case.get("elapsed_ms"), "worker_wall_ms": case.get("worker_wall_ms"),
           "request_body_bytes": sum(s.get("request_body_bytes", 0) for s in samples),
           "response_body_bytes": sum(s.get("response_body_bytes", 0) for s in samples),
           "verified_reply_bytes": sum(s.get("response_bytes", 0) for s in samples if s["status"] == "PASS")}
    row["reply_mbps"] = (row["verified_reply_bytes"] * 8 / row["elapsed_ms"] / 1000
                         if row["elapsed_ms"] else None)
    resources = case.get("resources")
    for role in ["client", "server", "fixture"]:
        row[role + "_cpu_ms"] = None
        row[role + "_rss_max_sampled_kib"] = None
        if resources:
            before, after = resources["before"][role], resources["after"][role]
            row[role + "_cpu_ms"] = (after["cpu_ticks"] - before["cpu_ticks"]) * 1000 / hz
            observations = [before, after] + [s[role] for s in resources["samples_100ms"]]
            row[role + "_rss_max_sampled_kib"] = max(s["rss_kib"] for s in observations)
    return row


def json_write(path, value):
    # Compact raw JSON is intentional: preserve all samples without multi-MiB pretty logs.
    path.write_text(json.dumps(value, separators=(",", ":")) + "\n")


def csv_write(path, rows):
    if not rows:
        return
    fields = list(dict.fromkeys(key for row in rows for key in row))
    with path.open("w", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def summarize(result):
    cases, requests, events, aggregates = [], [], [], []
    hz = result["clock_ticks_per_second"]
    for kind in KINDS:
        for name, spec in REALITY_CASES + HY2_CASES:
            group_rows, group_samples = [], []
            for number in range(1, 4):
                matches = [c for r in result.get("rounds", []) if r["candidate"] == kind and r["round"] == number
                           for c in r["cases"] if c["name"] == name]
                if len(matches) > 1:
                    raise ValueError("duplicate measured case")
                case = matches[0] if matches else {}
                tags = {"candidate": kind, "round": number, "case": name}
                row = dict(tags, **case_summary(case, spec["count"], hz))
                cases.append(row)
                group_rows.append(row)
                for index, s in enumerate(case.get("samples", [])):
                    requests.append(dict(tags, sample=index, **{k: v for k, v in s.items() if k != "events"}))
                    group_samples.append(s)
                    previous = None
                    for e in s.get("events", []):
                        event = dict(tags, sample=index, **e)
                        if previous:
                            event["client_gap_ms"] = e["client_arrival_ms"] - previous["client_arrival_ms"]
                            event["server_gap_ms"] = e["server_emit_ms"] - previous["server_emit_ms"]
                            event["excess_gap_ms"] = event["client_gap_ms"] - event["server_gap_ms"]
                        events.append(event)
                        previous = e
            aggregate = {"candidate": kind, "case": name}
            for key in ["expected", "emitted", "passed", "failed", "timeouts", "missing",
                        "request_body_bytes", "response_body_bytes", "verified_reply_bytes"]:
                aggregate[key] = sum(row[key] for row in group_rows)
            aggregate["success_rate"] = aggregate["passed"] / aggregate["expected"]
            for key in ["ttfb_ms", "first_event_ms", "elapsed_ms"]:
                # Failures remain here if the observation exists; missing TTFB is not fabricated.
                aggregate[key] = distribution([s[key] for s in group_samples if s.get(key) is not None])
            for key in ["client_gap_ms", "excess_gap_ms"]:
                aggregate[key] = distribution([e[key] for e in events
                    if e["candidate"] == kind and e["case"] == name and key in e])
            aggregate["reply_mbps_rounds"] = [r["reply_mbps"] for r in group_rows]
            aggregate["client_cpu_ms_rounds"] = [r["client_cpu_ms"] for r in group_rows]
            if all(r["client_cpu_ms"] is not None for r in group_rows) and aggregate["emitted"]:
                cpu = sum(r["client_cpu_ms"] for r in group_rows)
                aggregate["client_cpu_ms_per_emitted_request"] = cpu / aggregate["emitted"]
                body = aggregate["request_body_bytes"] + aggregate["response_body_bytes"]
                aggregate["client_cpu_ms_per_body_mib"] = cpu / (body / (1 << 20)) if body else None
                for role in ["client", "server", "fixture"]:
                    aggregate[role + "_rss_max_sampled_kib"] = max(r[role + "_rss_max_sampled_kib"] for r in group_rows)
            aggregates.append(aggregate)
    totals = {key: sum(row[key] for row in cases) for key in ["expected", "emitted", "passed", "failed", "timeouts", "missing",
                                                           "request_body_bytes", "response_body_bytes"]}
    return {"run_id": result["run_id"], "run_status": result["status"], "totals": totals,
            "cpu_tick_ms": 1000 / hz, "cases": aggregates}, cases, requests, events


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    measurement = json.loads((args.root / "measure-01/results.json").read_text())
    smoke = json.loads((args.root / "smoke-01/results.json").read_text())
    for result in [measurement, smoke]:
        for key in ["environment_before", "environment_after"]:
            result[key]["uname"]["node"] = "orb-hostname-omitted"
    summary, cases, requests, events = summarize(measurement)
    json_write(args.output / "measurement.json", measurement)
    json_write(args.output / "smoke.json", smoke)
    json_write(args.output / "summary.json", summary)
    json_write(args.output / "build.json", json.loads((args.root / "build-01/manifest.json").read_text()))
    csv_write(args.output / "cases.csv", cases)
    csv_write(args.output / "requests.csv", requests)
    csv_write(args.output / "events.csv", events)
    csv_write(args.output / "lifecycle.csv", [{k: v for k, v in row.items() if k != "https"}
                                              for row in measurement["lifecycle"]])
    proof = {}
    for run in ["smoke-01", "measure-01"]:
        cleanup = json.loads((args.root / run / "cleanup.json").read_text())
        network = json.loads((args.root / run / "host-network.json").read_text())
        execution = json.loads((args.root / run / "execution.json").read_text())
        proof[run] = {"cleanup": cleanup, "host_network_unchanged": network["unchanged"], "execution": execution,
                      "source_results_sha256": hashlib.sha256((args.root / run / "results.json").read_bytes()).hexdigest()}
    json_write(args.output / "provenance.json", proof)
    hashes = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(args.output.iterdir())}
    json_write(args.output / "SHA256.json", hashes)
    print(json.dumps(summary["totals"]))


if __name__ == "__main__":
    main()
