# R4-FixCP: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 02:55 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1170 | hunt/sol-r4fcp-home-bind-retire | needs-hardware | yes | fix(control-plane): fence home binding against fleet retirement |
| 1180 | hunt/sol-r4fcp-inactive-watermarks | — | yes | fix(exit-agent): recover inactive source billing watermarks |
| 1189 | hunt/sol-r4fcp-quality-utc | ui-review | no | fix(ops): preserve UTC days in quality charts |
| 1194 | hunt/sol-r4fcp-overdue-customer-counts | ui-review | no | fix(ops): retain expired customers in overdue reporting |
| 1203 | hunt/sol-r4fcp-home-inventory-retire | needs-hardware | yes | fix(control-plane): fence standalone home retirement against bindings |
| 1206 | hunt/sol-r4fcp-empty-counter-carry | — | yes | fix(exit-agent): retain recovery history before counters appear |
| 1208 | hunt/sol-r4fcp-customer-subject | ui-review | no | fix(ops): reset customer state when the route subject changes |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4CP-RETIRE-RELIST-FENCE | control-plane | P2 | services/control-plane/src/ops/reads/fleet.ts:270 | Retirement token cleanup can revoke a concurrent relist | duplicate of merged #1080; both caller revision fences present on main |
| R4FCP-HOME-BIND-RETIRE | control-plane | P2 | services/control-plane/src/ops/reads/fleet.ts:235 | Concurrent home binding can succeed after fleet retirement | real-fixed #1170; merged green CI; needs-hardware; auto-merge enabled |
| R4FCP-INACTIVE-RECOVERY-WATERMARK | control-plane/exit-agent | P2 | services/control-plane/src/exit-identity-roster.ts:36 | Lost-ledger recovery omits inactive source history and replays billing | real-fixed #1180; merged green CI; auto-merge enabled |
| R4FCP-FP-HOME-DELETE | control-plane | — | services/control-plane/src/ops/shared-admin/home-exits.ts:354 | Concurrent hard home deletion could leave dangling binding | false-positive ON DELETE RESTRICT and binding FK protect both commit orders |
| R4FCP-FP-TIMELINE-DATES | ops-console | — | services/ops-console/src/pages/customer/Timeline.tsx:234 | Timeline local date labels shift UTC buckets | false-positive timeline creates local calendar buckets |
| R4FCP-FP-LOAD-DATES | ops-console | — | services/ops-console/src/pages/node/Load.tsx:45 | Load chart local labels shift daily buckets | false-positive node and fleet load points are actual sample instants |
| R4FCP-QUALITY-UTC-DATES | ops-console | P2 | services/ops-console/src/pages/today/Quality.tsx:154 | Quality charts shift UTC SLO dates west of UTC | real-fixed #1189; green CI; ui-review; no auto-merge |
| R4FCP-OVERDUE-CUSTOMER-COUNTS | ops-console | P2 | services/ops-console/src/lib/customer-board.ts:36 | API-expired rows disappear from overdue KPI and lapsed chart | real-fixed #1194; green CI; ui-review; no auto-merge |
| R4FCP-HOME-INVENTORY-RETIRE | control-plane | P2 | services/control-plane/src/ops/shared-admin/home-exits.ts:329 | Standalone home retirement can strand a concurrent binding | real-fixed #1203; merged green CI; needs-hardware; auto-merge enabled |
| R4FCP-EMPTY-COUNTER-CARRY | exit-agent | P2 | services/exit-agent/reconcile_and_report.py:1310 | Empty-counter ledger recovery absorbs subsequently observed usage | real-fixed #1206; merged green CI; auto-merge enabled |
| R4FCP-SIBLING-UTC-DATES | ops-console | P2 | services/ops-console/src/pages/node/Errors.tsx:86 | Error and home-line usage bars shift UTC dates | real-unfixed #1200; requires UI review, outside assigned UI fix scope |
| R4FCP-FP-SNAPSHOT-QUEUE | exit-agent | — | services/exit-agent/reconcile_and_report.py:1955 | Stale roster watermark after pending delivery could rebill history | false-positive pending delivered before fold; local totals dominate queue; adoption never lowers totals |
| R4FCP-FP-MULTI-LABEL | exit-agent | — | services/exit-agent/reconcile_and_report.py:1244 | Watermark allocation could duplicate across disappearing labels or restart | false-positive absent labels retain carry; separate baselines; allocation preserves per-user sum |
| R4FCP-FP-ACK-RECOVERY | exit-agent | — | services/exit-agent/reconcile_and_report.py:1945 | Interrupted inventory save could bypass lost-ledger recovery | false-positive fresh adoption runs each reporting round regardless ledger_missing |
| R4FCP-FP-ROLLOVER-REVOKE | control-plane | — | services/control-plane/src/index.ts:1760 | Stale usage scan could revoke renewed account | false-positive enforceUser rereads eligibility and revokeDevice repeats transactional predicate; reset retains source history |
| R4FCP-FP-CONCURRENT-REPORTERS | exit-agent | — | services/exit-agent/reconcile_and_report.py:935 | Concurrent timers could race cumulative source state | false-positive full-cycle file lock; bypass requires administrator misconfiguration |
| R4FCP-FP-DISABLED-HOME | control-plane | — | services/control-plane/src/ops/shared-admin/home-exits.ts:333 | Disabling bound home makes catalog unavailable | false-positive documented intentional administrator pause (#399/#78); retired status alone requires unbound |
| R4FCP-CUSTOMER-SUBJECT | ops-console | P1 | services/ops-console/src/app/App.tsx:139 | Customer navigation pairs prior billing with new account mutation target | real-fixed #1208; green CI; ui-review; no auto-merge |
| R4FCP-FP-PUBLISH-CAS | control-plane | — | services/control-plane/src/ops/shared-admin/traffic-policy.ts:113 | Concurrent publication could overwrite newer policy/catalog | false-positive revision CAS, affected-row check and INSERT OR IGNORE protect both writes |
| R4FCP-FP-PRODUCT-REPLACE | control-plane | — | services/control-plane/src/product-account.ts:390 | Failed replacement could retire current account without replacement | false-positive availability predicate and changes() chaining run in one D1 batch |
| R4FCP-FP-RESET-BASELINE | control-plane | — | services/control-plane/src/ops/legacy-handlers/users.ts:446 | Cumulative telemetry could undo operator usage reset | false-positive reset atomically advances usage baseline; distinct hypothesis from renewal-vs-revocation |
| R4FCP-FP-FLEET-SESSION | ops-console | — | services/ops-console/src/lib/use-fleet.ts:35 | Optional fleet read could swallow expired-session response | false-positive SessionExpiredError rethrows and outer catch removes ready state |
| R4FCP-FP-CLIENT-ROLE | ops-console/control-plane | — | services/ops-console/src/lib/roles.ts:18 | Client owner default could authorize delegated ops writes | false-positive server independently derives and gates role; client role controls presentation |
| R4FCP-FP-RENEW-RETRY | ops-console | — | services/ops-console/src/pages/customer/ExpiryDrawer.tsx:206 | Ledger-error retry could renew expiry twice | false-positive confirmation captures fixed expiry target; separate ledger/expiry writes deliberate |
| R4FCP-FP-DOUBLE-CLICK | ops-console | — | services/ops-console/src/components/ops/Action.tsx:28 | Ordinary double-click could duplicate billing writes | false-positive pending disables control/removes handler before await; reentrant same-turn race not reproduced |
| R4FCP-FP-LEGACY-TIMEOUT | ops-console | — | services/ops-console/src/lib/api.ts:40 | Unsupported browser timeout composition could hang machine/session | false-positive hypothesis consequence is abortable pending console read, not machine/session hang; no high-severity path proved |
| R4FCP-FP-LEGACY-ROLE-READ | control-plane | — | services/control-plane/src/ops/access-roles.ts:112 | Legacy GET could bypass delegated-role checks | false-positive access-role tables gate before router; unknown routes require owner |
| R4FCP-FP-NODE-SUBJECT | ops-console | — | services/ops-console/src/pages/NodeDetail.tsx:76 | Node navigation could retain wrong-subject actions persistently | false-positive changed-subject loading unmounts actions; no sticky relabel path |
| R4FCP-DUP-CLOSE-REPLACEMENT | control-plane | P2 | services/control-plane/src/ops/shared-admin/catalog.ts:79 | Account replacement could race customer close | duplicate of merged #1186; close retires live assignment in own D1 batch |
