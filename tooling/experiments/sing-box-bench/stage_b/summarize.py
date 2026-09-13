#!/usr/bin/env python3
"""Export every sample, plus small-sample summaries without p99 or winner claims."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import statistics


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path, help="New directory")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    data = json.loads(args.input.read_text())
    rows, summaries, resources = [], [], []
    for record in data.get("rounds", []):
        for sample in record["samples"]:
            rows.append(dict(sample, candidate=record["candidate"], round=record["round"]))
        for case in record["cases"]:
            clocks = data["clock_ticks_per_second"]
            resource = {"candidate": record["candidate"], "round": record["round"], "case": case["name"]}
            for role in ["client", "server"]:
                resource[role + "_cpu_seconds"] = (case["after"][role]["cpu_ticks"] - case["before"][role]["cpu_ticks"]) / clocks
                resource[role + "_sampled_peak_rss_kib"] = max(o[role]["rss_kib"] for o in case["usage_50ms"])
                resource[role + "_sampled_peak_fds"] = max(o[role]["fd_count"] for o in case["usage_50ms"])
            resource["small_requests_fully_overlapping_bulk"] = case.get("small_requests_fully_overlapping_bulk")
            resources.append(resource)
    fields = sorted({key for row in rows for key in row})
    with (args.output / "samples.csv").open("w") as file:
        writer = csv.DictWriter(file, fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
    for candidate in ["mihomo", "gvisor", "go"]:
        for round_number in [1, 2, 3]:
            groups = sorted({(row["case"], row["port"]) for row in rows
                             if row["candidate"] == candidate and row["round"] == round_number})
            for case, port in groups:
                samples = [row for row in rows if (row["candidate"], row["round"], row["case"], row["port"])
                           == (candidate, round_number, case, port)]
                successful = [row for row in samples if row["status"] == "PASS"]
                latency = [row["ttfb_ms"] for row in successful]
                summaries.append({"candidate": candidate, "round": round_number, "case": case, "port": port,
                    "n": len(samples), "successes": len(successful),
                    "timeouts": sum(row["status"] == "TIMEOUT" for row in samples),
                    "failures": sum(row["status"] == "FAIL" for row in samples),
                    "success_ttfb_median_ms": statistics.median(latency) if latency else None,
                    "success_ttfb_min_ms": min(latency, default=None),
                    "success_ttfb_max_ms": max(latency, default=None),
                    "observed_ttfb_over_1200ms": sum(row["ttfb_ms"] is not None and row["ttfb_ms"] > 1200 for row in samples),
                    "no_first_byte_observed": sum(row["ttfb_ms"] is None for row in samples),
                    "payload_mbps_including_failed_attempt_time": sum(row["received_bytes"] for row in samples) * 8 / max(
                        sum(row["elapsed_ms"] for row in samples), .001) / 1000})
    result = {"input_sha256": hashlib.sha256(args.input.read_bytes()).hexdigest(),
              "run_id": data["run_id"], "status": data["status"],
              "warning": "Latency conditional on success; every failure/timeout retained. Throughput is bytes / sum request time, not aggregate concurrent goodput.",
              "round_case_summary": summaries, "resources": resources}
    (args.output / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
    # Keep every measurement and failure, but omit repeated /proc and resource samples from this compact export.
    compact = {key: value for key, value in data.items() if key not in ["rounds", "environment_before", "environment_after"]}
    compact["samples"] = rows
    compact["resources"] = resources
    (args.output / "raw.json").write_text(json.dumps(compact, indent=2) + "\n")
    print(json.dumps({"samples": len(rows), "successes": sum(row["status"] == "PASS" for row in rows),
                      "input_status": data["status"], "output": str(args.output)}))


if __name__ == "__main__":
    main()
