# R4-CPcore: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:50 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4CPC-OLD-DEVICE-REFRESH | sessions | P2 | services/control-plane/src/sessions.ts:49 | Earlier same-device refresh chains survive new sign-in | duplicate of H17-G-F5 / PR #833 |
| R4CPC-LOGOUT-SUCCESSOR | sessions | P2 | services/control-plane/src/index.ts:2463 | Concurrent refresh might survive logout | false-positive #800 recursive CTE follows all committed successors; later rotation loses revoke |
| R4CPC-REVOKED-SESSION-INSERT | devices | P2 | services/control-plane/src/sessions.ts:44 | Sign-in might insert a session after device removal | false-positive migration 0035 eligibility trigger serializes with removal |
| R4CPC-ENROLLMENT-OLD-IDENTITY | devices | P2 | services/control-plane/src/index.ts:1875 | Reopened installation might enroll before prior identity deletion | false-positive durable unfinished revocation fence is rechecked in issuance UPDATE |
| R4CPC-RENEWAL-ENFORCEMENT | usage | P2 | services/control-plane/src/index.ts:1760 | Post-ingest enforcement might revoke a renewed or reset account | false-positive eligibility is rechecked in enforceUser and revokeDevice transaction |
| R4CPC-OIDC-BODY-UNAVAILABLE | oidc | P3 | services/control-plane/src/oidc.ts:107 | A provider key-body transport failure is returned as rejected authentication | real-verified regression returned401 instead of503; fix in progress |
| R4CPC-QUOTA-STALE-SAMPLE | node quota | P2 | services/control-plane/src/ops/quota.ts:288 | Older counters committed after a newer observation create a false reset and double-count usage | real-verified D1 reproduction100 expected vs300 actual; coordinated timestamp retention fix needed |
| R4CPC-WITHDRAWN-LEDGER-RECOVERY | usage recovery | P2 | services/control-plane/src/exit-identity-roster.ts:47 | Missing exit ledger rebills retained counters for users omitted from eligible roster | real-verified Python run_once80 emitted over server1050; agent recovery outside assigned files |
| R4CPC-CLOSE-REPLACEMENT | product account | P2 | services/control-plane/src/ops/shared-admin/catalog.ts:83 | Concurrent account replacement escapes close and remains billable | real-verified real D1 disabled user with assigned replacement; caller outside assigned files |
| R4CPC-USAGE-BATCH-PARTIAL | usage | P2 | services/control-plane/src/index.ts:3423 | Partial billing writes on ingest failure | false-positive all source and account writes use one transactional D1 batch |
| R4CPC-USAGE-CUTOVER-RACE | usage | P2 | services/control-plane/src/index.ts:3425 | Stale dual-phase preflight might commit after cutover | false-positive phase and legacy liveness triggers abort the full stale batch |
| R4CPC-USAGE-REMOVED-DEVICE-FINAL | usage | P2 | services/control-plane/src/index.ts:3419 | Removed device final usage might be discarded | false-positive ingest requires existing user and accepts queued final traffic without a live device |
| R4CPC-USAGE-V2-TIED-AT | usage | P2 | services/control-plane/src/index.ts:3563 | Same-second reports might discard legitimate growth | false-positive agents persist strictly increasing observation stamps; duplicate observation rejection is intentional |
| R4CPC-QUOTA-STALE-OVERWRITE | node quota | P2 | services/control-plane/src/ops/quota.ts:322 | Absolute stale write alone might permanently double-count usage | false-positive next monotonic cumulative read self-heals; actual false reset is recorded separately |
| R4CPC-CONFIRM-OTHER-DEVICE | devices | P2 | services/control-plane/src/index.ts:1992 | Session might confirm another installation on same account | false-positive claim binds authenticated installation ID and unique user/installation pair |
