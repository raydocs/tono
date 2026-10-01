# R4-RegCP: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 23:23 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1065 | hunt/sol-r4cp-retirement-timeout | needs-hardware | yes | fix(exit-agent): preserve revocation inventory after config validation timeout |
| 1080 | hunt/sol-r4cp-retire-relist-fence | needs-hardware | yes | fix(control-plane): fence retirement token cleanup against concurrent relist |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4CP-RETIRE-VALIDATION-TIMEOUT | exit-agent | P1 | services/exit-agent/reconcile_and_report.py:1491 | Static retirement CLI timeout skips inventory durability and later revocation misses installed client | real-fixed #1065 |
| R4-OPS-UTC-SIBLING | ops-console | P2 | services/ops-console/src/pages/today/Quality.tsx:168 | Quality dashboards render UTC daily SLO buckets with local dates | real-unfixed issue #1067; UI changes excluded by hunt scope |
| R4-OPS-EXPIRY-LIFECYCLE | ops-console | P2 | services/ops-console/src/lib/customer-board.ts:36 | Expired lifecycle customers disappear from overdue count and lapsed chart | real-unfixed issue #1068; UI changes excluded by hunt scope |
| REGCP-MISSING-EXPIRED-WATERMARK | exit-agent/control-plane | P2 | services/exit-agent/reconcile_and_report.py:1264 | Lost ledger recovery replays counters for inactive users omitted from source watermarks | real-unfixed issue #1069; needs recovery API/agent contract change |
| R4CP-RETIRE-RELIST-FENCE | control-plane/catalog | P2 | services/control-plane/src/ops/reads/fleet.ts:269 | Immediate retirement cleanup disables token after a concurrent relist succeeds | real-fixed #1080 |
