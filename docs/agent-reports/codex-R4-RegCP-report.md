Four fixes merged through CI. Reviewed **56 merged PRs** and examined **28 hypotheses**.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4CP-RETIRE-VALIDATION-TIMEOUT | Exit-agent | P1 | reconcile_and_report.py:1504 | Validation timeout loses inventory needed for later revocation | Fixed [#1065](https://github.com/raydocs/tono/pull/1065) |
| R4CP-RETIRE-RELIST-FENCE | Catalog | P2 | reads/fleet.ts:270 | Stale retirement disables a concurrently relisted node | Fixed [#1080](https://github.com/raydocs/tono/pull/1080) |
| R4CP-LEDGER-PAGE-VALIDATOR | Ledger API | P3 | handlers/ledger.ts:154 | Edited rows retain stale conditional-read validators | Fixed [#1091](https://github.com/raydocs/tono/pull/1091) |
| R4CP-LEDGER-NESTED-REVERSAL | Ledger CSV | P2 | ledger.ts:325 | Undoing a reversal produces the wrong source total | Fixed [#1096](https://github.com/raydocs/tono/pull/1096) |
| R4-OPS-UTC-SIBLING | Ops console | P2 | today/Quality.tsx:154 | UTC daily buckets display the previous local date | Open [#1067](https://github.com/raydocs/tono/issues/1067); UI excluded |
| R4-OPS-EXPIRY-LIFECYCLE | Ops console | P2 | customer-board.ts:36 | Expired customers disappear from overdue statistics | Open [#1068](https://github.com/raydocs/tono/issues/1068); UI excluded |
| REGCP-MISSING-EXPIRED-WATERMARK | Metering | P2 | reconcile_and_report.py:1239 | Missing-ledger recovery can replay expired-user counters | Open [#1069](https://github.com/raydocs/tono/issues/1069); recovery contract needed |

All four PRs merged using merge-commit auto-merge. **#1065 and #1080:** `needs-hardware`. **#1091 and #1096:** no labels.

Validation passed: **979 control-plane tests**, coverage gates, typecheck, and **46 targeted tests on final main**, including the late #1083 combination.

**21 hypotheses were rejected or false positives**, including the earlier #833 concern, which its updated diff resolved. The complete table and rejection reasons are in the [report](/workspace/w1-codex/out/R4-RegCP/report.md), with incremental [findings](/workspace/w1-codex/out/R4-RegCP/findings.tsv) and [PR records](/workspace/w1-codex/out/R4-RegCP/prs.tsv).

Production/VPS and hardware acceptance were not run. Untouched legacy code was not exhaustively audited. No deployment or publication.