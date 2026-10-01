# R3-C4E1: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 21:19 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1009 | hunt/sol-r3ingest-cli-inventory | needs-hardware | yes | fix(exit-agent): retain revocation inventory on CLI exceptions |

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
