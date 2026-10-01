Seven fixes shipped; **all seven PRs have green CI**. Four merged. Three await UI review, with auto-merge disabled.

Paths below are relative to each service: CP=`control-plane/src`, Ops=`ops-console/src`, EA=`exit-agent`.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| R4CP-RETIRE-RELIST-FENCE | CP | P2 | ops/reads/fleet.ts:270 | Retirement revokes a relisted token | Duplicate of merged #1080 |
| R4FCP-HOME-BIND-RETIRE | CP | P2 | ops/reads/fleet.ts:235 | Binding succeeds after fleet retirement | Fixed in #1170 |
| R4FCP-INACTIVE-RECOVERY-WATERMARK | CP/EA | P2 | exit-identity-roster.ts:36 | Inactive history omitted during recovery | Fixed in #1180 |
| R4FCP-QUALITY-UTC-DATES | Ops | P2 | pages/today/Quality.tsx:154 | UTC SLO dates shift locally | Fixed in #1189 |
| R4FCP-OVERDUE-CUSTOMER-COUNTS | Ops | P2 | lib/customer-board.ts:36 | Expired customers disappear from overdue totals | Fixed in #1194 |
| R4FCP-HOME-INVENTORY-RETIRE | CP | P2 | ops/shared-admin/home-exits.ts:329 | Standalone retirement strands concurrent bindings | Fixed in #1203 |
| R4FCP-EMPTY-COUNTER-CARRY | EA | P2 | reconcile_and_report.py:1310 | Empty recovery snapshot absorbs later usage | Fixed in #1206 |
| R4FCP-CUSTOMER-SUBJECT | Ops | **P1** | app/App.tsx:139 | Prior customer billing targets the next account | Fixed in #1208 |
| R4FCP-SIBLING-UTC-DATES | Ops | P2 | pages/node/Errors.tsx:86 | Error/home-usage bars shift UTC dates | Unfixed #1200; outside assigned UI exceptions |
| R4FCP-DUP-CLOSE-REPLACEMENT | CP | P2 | ops/shared-admin/catalog.ts:79 | Replacement races customer closure | Duplicate of merged #1186 |
| R4FCP-FP-HOME-DELETE | CP | — | ops/shared-admin/home-exits.ts:354 | Deletion leaves dangling binding | False positive: FK restriction |
| R4FCP-FP-TIMELINE-DATES | Ops | — | pages/customer/Timeline.tsx:234 | Timeline dates shift buckets | False positive: buckets are local |
| R4FCP-FP-LOAD-DATES | Ops | — | pages/node/Load.tsx:45 | Load labels shift daily buckets | False positive: actual sample instants |
| R4FCP-FP-SNAPSHOT-QUEUE | EA | — | reconcile_and_report.py:1955 | Stale watermark rebills pending usage | False positive: queue precedes folding |
| R4FCP-FP-MULTI-LABEL | EA | — | reconcile_and_report.py:1244 | Labels duplicate recovery totals | False positive: account sum preserved |
| R4FCP-FP-ACK-RECOVERY | EA | — | reconcile_and_report.py:1945 | Interrupted save bypasses recovery | False positive: adoption runs each round |
| R4FCP-FP-ROLLOVER-REVOKE | CP | — | index.ts:1760 | Stale scan revokes renewed account | False positive: eligibility rechecked |
| R4FCP-FP-CONCURRENT-REPORTERS | EA | — | reconcile_and_report.py:935 | Timers race source state | False positive: full-cycle lock |
| R4FCP-FP-DISABLED-HOME | CP | — | ops/shared-admin/home-exits.ts:333 | Disabled bound home blocks catalog | False positive: documented admin pause |
| R4FCP-FP-PUBLISH-CAS | CP | — | ops/shared-admin/traffic-policy.ts:113 | Concurrent publication loses updates | False positive: revision CAS |
| R4FCP-FP-PRODUCT-REPLACE | CP | — | product-account.ts:390 | Failed replacement retires old account | False positive: transactional guards |
| R4FCP-FP-RESET-BASELINE | CP | — | ops/legacy-handlers/users.ts:446 | Telemetry undoes usage reset | False positive: atomic baseline update |
| R4FCP-FP-FLEET-SESSION | Ops | — | lib/use-fleet.ts:35 | Optional read hides expired session | False positive: explicitly rethrows |
| R4FCP-FP-CLIENT-ROLE | Ops/CP | — | lib/roles.ts:18 | Client default grants privileged writes | False positive: independent server gates |
| R4FCP-FP-RENEW-RETRY | Ops | — | pages/customer/ExpiryDrawer.tsx:206 | Retry renews expiry twice | False positive: fixed captured target |
| R4FCP-FP-DOUBLE-CLICK | Ops | — | components/ops/Action.tsx:28 | Double-click duplicates billing writes | False positive: pending disables handler |
| R4FCP-FP-LEGACY-TIMEOUT | Ops | — | lib/api.ts:40 | Timeout compatibility hangs machine/session | False positive: abortable console read |
| R4FCP-FP-LEGACY-ROLE-READ | CP | — | ops/access-roles.ts:112 | Legacy reads bypass role checks | False positive: gates precede dispatch |
| R4FCP-FP-NODE-SUBJECT | Ops | — | pages/NodeDetail.tsx:76 | Node navigation retains wrong-subject actions | False positive: loading unmounts actions |

| PR | Status | Labels | Auto-merge |
|---|---|---|---|
| [#1170](https://github.com/raydocs/tono/pull/1170) | Merged | needs-hardware | Yes, merge commit |
| [#1180](https://github.com/raydocs/tono/pull/1180) | Merged | — | Yes, merge commit |
| [#1189](https://github.com/raydocs/tono/pull/1189) | Awaiting review | ui-review | No |
| [#1194](https://github.com/raydocs/tono/pull/1194) | Awaiting review | ui-review | No |
| [#1203](https://github.com/raydocs/tono/pull/1203) | Merged | needs-hardware | Yes, merge commit |
| [#1206](https://github.com/raydocs/tono/pull/1206) | Merged | — | Yes, merge commit |
| [#1208](https://github.com/raydocs/tono/pull/1208) | Awaiting review — P1 | ui-review | No |

**29 hypotheses examined; 19 false positives; two duplicates; eight verified bugs.** Seven fixed, one reported unfixed.

Local checks passed: control-plane suite **995 tests**, exit-agent **116 tests plus seven subtests**, focused ops regressions, typechecks and targeted lint. Each fix has failing-before/passing-after evidence and independent review.

Unfinished: exhaustive coverage of all three service trees, live/native network acceptance, and #1200. No deployment or publication occurred; no availability/AI-blocking tradeoff was taken.

[Full report](/workspace/w1-codex/out/R4-FixCP/report.md) · [Findings TSV](/workspace/w1-codex/out/R4-FixCP/findings.tsv) · [PR TSV](/workspace/w1-codex/out/R4-FixCP/prs.tsv)