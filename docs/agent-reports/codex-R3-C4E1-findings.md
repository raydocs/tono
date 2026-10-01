# R3-C4E1: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 21:46 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1009 | hunt/sol-r3ingest-cli-inventory | needs-hardware | yes | fix(exit-agent): retain revocation inventory on CLI exceptions |
| 1015 | hunt/sol-r3ingest-quota-rollup-counters | none | yes | fix(control-plane): preserve complete quota counters in retention |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| EXIT-CLI-EXCEPTION-INVENTORY | E1 | P1 | services/exit-agent/reconcile_and_report.py:1153 | CLI timeout or filesystem exception drops partial client inventory; later revocation misses clients | real-fixed #1009 |
| CP-POLICY-SUFFIX-OVERLAP | C4 | — | services/control-plane/src/traffic-policy.ts:329 | Signed DIRECT suffix overlaps AI-service domains | false-positive exact, child and ancestor overlaps are rejected |
| CP-POLICY-UNSIGNED-ENDPOINT | C4 | — | services/control-plane/src/traffic-policy.ts:65 | Unsigned endpoint widens direct admission | false-positive signature gate and native clients discard unsigned entries |
| CP-POLICY-STALE-SIGNATURE | C4 | — | services/control-plane/src/ops/shared-admin/traffic-policy.ts:105 | Republishing keeps an incompatible signature | false-positive replacing unsigned policy clears signature |
| CP-POLICY-SIGNED-DOWNGRADE | C4 | — | services/control-plane/src/traffic-policy.ts:388 | Unsigned policy replaces authenticated revision | false-positive native authenticated-revision ratchet |
| CP-PRODUCT-POOL-RACE | C4 | — | services/control-plane/src/product-account.ts:265 | Concurrent pooled assignment grants two customers | false-positive guarded transactional batch and unique assignment index |
| CP-PRODUCT-REPLACE-ATOMICITY | C4 | — | services/control-plane/src/product-account.ts:387 | Failed replacement leaves paying customer unassigned | false-positive retirement and replacement commit atomically |
| CP-PRODUCT-BAN-ENTITLEMENT | C4 | — | services/control-plane/src/product-account.ts:342 | Provider account ban disables VPN entitlement | false-positive product ledger and user entitlement are separate |
| MAC-ASSISTANT-DIRECT-GAP | C4 caller | P1 | apps/macos/Tono/Core/ConfigPipeline+Runtime.swift | Native DIRECT can capture AI without residential hop | duplicate of #867 |
| E1-RAW-RESET | E1 | — | services/exit-agent/reconcile_and_report.py:1192 | Raw counter decrease refunds usage | false-positive reset reading contributes new delta |
| E1-BUSY-RESET | E1 | — | services/exit-agent/reconcile_and_report.py:1394 | Restart counters crossing old watermark hide usage | false-positive stable process-marker bracket detects restart |
| E1-GENERATION-HISTORY | E1 | — | services/exit-agent/reconcile_and_report.py:1228 | Removed credential generation loses usage history | false-positive retained label totals aggregate by account |
| E1-ACK-DOUBLE-BILL | E1 | — | services/exit-agent/reconcile_and_report.py:1984 | Lost delivery ACK bills cumulative usage twice | false-positive durable queue and monotonic source replay guards |
| E1-CLOCK-SKEW | E1 | — | services/exit-agent/reconcile_and_report.py:1927 | Bad node clock corrupts report timestamps | false-positive server-roster-derived monotonic timestamp and future guard |
| E1-EMPTY-ROSTER | E1 | — | services/exit-agent/reconcile_and_report.py:558 | Malformed roster removes all paying customers | false-positive validation and authenticated node match precede mutations |
| E1-UNKNOWN-READINESS | E1 | — | services/exit-agent/reconcile_and_report.py:1897 | Unknown initial inventory falsely proves readiness | false-positive explicit refusal preserves unknown inventory |
| E1-OUTAGE-WITHDRAWAL | E1 | — | services/exit-agent/reconcile_and_report.py:1631 | Temporary control-plane outage empties clients | false-positive verified cached roster or no mutation |
| E1-HY2-LIVE-REVOKE | E1 | — | services/exit-agent/README.md:146 | HY2 allowlist replacement immediately terminates existing QUIC sessions | false-positive documented subsequent-authentication contract |
| E1-TRUNCATED-REPLY | E1 | — | services/exit-agent/reconcile_and_report.py:1300 | Interrupted usage reply loses delivered usage | false-positive pending queue remains durable and cumulative |
| E1-ACK-RESTART-LOSS | E1 | P2 | services/exit-agent/reconcile_and_report.py:1908 | ACK failure then core restart loses uncommitted reading | false-positive as new finding; two failures and deliberate ACK-before-usage ordering |
| E1-HY2-LEDGER-MISSING | E1 | P2 | services/exit-agent/reconcile_and_report.py:1873 | Ledger loss plus HY2 failure can retain raw lifetime | duplicate of #914 recovery boundary plus second independent failure |
| SOL-C4-QUOTA-RETENTION-REWIND | C4 | P2 | services/control-plane/src/ops/quota.ts:438 | Null final metric samples discard last valid counter at retention; fallback rebills older cumulative bytes | real-fixed #1015; ops display only; no production incident claim |
| SOL-C4-ACTIVITY-FUTURE | C4 | — | services/control-plane/src/ops/customers.ts:150 | Future device window is projected into invisible future activity rows and outlives receipt-based retention | false-positive as verified ordinary trigger; far-future TLS/session failure and no durable full-window queue; clock-correction timing unproven |
| SOL-C4-ACTIVITY-OVERLAP | C4 | P3 | services/control-plane/src/ops/customers.ts:178 | 22-minute windows every20 minutes sum beyond60 minutes for one device | real-unfixed: interval/aggregation decision related O1-ACTIVITY-HOUR-COLLISION; source trace only; ops only |
| SOL-C4-CYCLE-INSERT-GAP | C4 | — | services/control-plane/src/ops/quota-cycle.ts:86 | A failed successor insert could leave an expired cycle closed without successor | duplicate: fixed #852, successor insert and old close atomic batch |
| SOL-C4-FP-QUOTA-RETRY | C4 | — | services/control-plane/src/ops/quota.ts:323 | Retry after retention or response failure might count identical cumulative reading again | false-positive: counter last watermark commits with used before retention and retry computes zero delta |
| SOL-C4-FP-ROLLUP-RESET | C4 | — | services/control-plane/src/ops-timeseries.ts:296 | Node restart could make rollup keep pre-reset MAX counter | false-positive: current code ranks closing observation rather than largest counter; existing two-tier restart regression |
| SOL-C4-FP-HOUR-FIRST | C4 | — | services/control-plane/src/ops-usage-hours.ts:125 | First customer snapshot or cycle reset might charge the full historical reading to hourly usage | false-positive: no prior reading or a decrease emits null rather than invented bytes |
| SOL-C4-FP-HOUR-SPARSE | C4 | — | services/control-plane/src/ops-usage-hours.ts:120 | Unchanged counters across sparse hours might lose interval usage | false-positive: query carries prior counter and reconstructs unchanged hours as zero; deltas telescope to next change |
| SOL-C4-FP-HOUR-RETRY | C4 | — | services/control-plane/src/ops-usage-hours.ts:52 | Repeated cron within an hour might replace or duplicate the baseline | false-positive: ON CONFLICT DO NOTHING makes first hourly snapshot immutable by explicit contract |
| SOL-C4-FP-LONG-ROUTE | C4 | — | services/control-plane/src/telemetry-window.ts:192 | Long retry route-byte interval might expand observed online time past six hours | false-positive: activity slices use separate event window bounds; route-byte interval explicitly independent and diagnostic |
| SOL-C4-FP-METRIC-FUTURE | C4 | — | services/control-plane/src/ops-timeseries.ts:90 | Future collector clock might poison last counter ordering forever | false-positive: invalid or more-than-five-minute-ahead observedAt clamped to receipt before storage |
| SOL-C4-FP-ACTIVITY-REPLAY | C4 | — | services/control-plane/src/ops/customers.ts:163 | Ingest hook plus cron projection might count the same telemetry row twice | false-positive: window claim and guarded additions are in one atomic batch |
| SOL-C4-FP-QUOTA-CUTOFF | C4 | — | services/control-plane/src/ops/quota.ts:354 | Wrong node quota percentage might automatically remove paying customer exits | false-positive: no auto-unlist enforcement caller; node quota only drives display and weekly planning |
| SOL-C4-FP-DIAGNOSTIC-BILLING | C4 | — | services/control-plane/src/telemetry-window.ts:24 | Route or event diagnostic byte retries might double bill customer allowance | false-positive: diagnostic traffic feeds activity projections only; users.usage_bytes uses separate report ingest |
| CP-INGEST-V2-REPLAY | C4 | — | services/control-plane/src/index.ts:3553 | Pruned report IDs allow a high-water replay to rebill after reset | false-positive strictly newer protocol-v2 source timestamp is required |
| CP-INGEST-BATCH-RESET | C4 | — | services/control-plane/src/index.ts:3394 | Two observations manufacture an invalid counter/timestamp pair | false-positive at most one report per account/source is accepted per batch |
| CP-INGEST-PROTOCOL-DOWNGRADE | C4 | — | services/control-plane/src/index.ts:3559 | Delayed v1 growth advances a settled v2 source | false-positive protocol watermark blocks lower-version source updates |
| CP-INGEST-ACCOUNT-RESET | C4 | — | services/control-plane/src/index.ts:3644 | Next report undoes a customer billing-cycle reset | false-positive billing baseline is separate from monotonic lifetime source authority |
| CP-INGEST-REVOCATION-RETRY | C4 | — | services/control-plane/src/index.ts:3679 | Enforcement failure after committed usage makes retries double bill | false-positive transaction commits cumulative source first; v2 replay is idempotent and cron retries enforcement |
| CP-INGEST-UNKNOWN-USERS | C4 | — | services/control-plane/src/index.ts:3419 | One unknown account permanently loses an otherwise valid meter batch | false-positive validation precedes transaction; exit-agent bisects400 responses and retains valid cumulative reports |
