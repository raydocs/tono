Both fixes merged through green CI.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| EXIT-CLI-EXCEPTION-INVENTORY | E1 | P1 | `services/exit-agent/reconcile_and_report.py:1153` | CLI exceptions forget clients that later require revocation | Fixed in [#1009](https://github.com/raydocs/tono/pull/1009) |
| SOL-C4-QUOTA-RETENTION-REWIND | C4 | P2 | `services/control-plane/src/ops-timeseries.ts:302` | Retention fabricates counter resets and inflates ops quota usage | Fixed in [#1015](https://github.com/raydocs/tono/pull/1015) |
| SOL-C4-ACTIVITY-OVERLAP | C4 | P3 | `services/control-plane/src/ops/customers.ts:178` | Overlapping telemetry windows inflate activity minutes | Real, unfixed: aggregation contract needs a decision |

Both PRs used merge-commit auto-merge. #1009 retains `needs-hardware`; #1015 needs no hardware/UI label.

Local checks passed: **110 Python tests**, **28 quota/retention tests**, and TypeScript typechecking.

**41 hypotheses examined:** 35 rejected/false positives, three duplicates, two fixes, one decision item. The [complete report](/workspace/w1-codex/out/R3-C4E1/report.md) contains every hypothesis, location, and rejection reason.

Assigned code review is complete. Real Xray/VPS and native-device acceptance remain unrun. No deployment or publication.