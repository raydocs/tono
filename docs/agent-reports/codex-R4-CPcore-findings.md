# R4-CPcore: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 02:55 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1176 | hunt/sol-r4cpc-oidc-body-unavailable | - | yes | fix(control-plane): classify interrupted provider key bodies as unavailable |
| 1183 | hunt/sol-r4cpc-quota-minute-pair | - | yes | fix(control-plane): retain complete counter pairs on partial minute updates |
| 1186 | hunt/sol-r4cpc-close-current-product | - | yes | fix(control-plane): retire current product assignment during account close |
| 1190 | hunt/sol-r4cpc-access-body-unavailable | - | yes | fix(control-plane): classify interrupted Access key bodies as unavailable |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4CPC-OLD-DEVICE-REFRESH | sessions | P2 | services/control-plane/src/sessions.ts:49 | Earlier same-device refresh chains survive new sign-in | duplicate of H17-G-F5 / PR #833 |
| R4CPC-LOGOUT-SUCCESSOR | sessions | P2 | services/control-plane/src/index.ts:2463 | Concurrent refresh might survive logout | false-positive #800 recursive CTE follows all committed successors; later rotation loses revoke |
| R4CPC-REVOKED-SESSION-INSERT | devices | P2 | services/control-plane/src/sessions.ts:44 | Sign-in might insert a session after device removal | false-positive migration 0035 eligibility trigger serializes with removal |
| R4CPC-ENROLLMENT-OLD-IDENTITY | devices | P2 | services/control-plane/src/index.ts:1875 | Reopened installation might enroll before prior identity deletion | false-positive durable unfinished revocation fence is rechecked in issuance UPDATE |
| R4CPC-RENEWAL-ENFORCEMENT | usage | P2 | services/control-plane/src/index.ts:1760 | Post-ingest enforcement might revoke a renewed or reset account | false-positive eligibility is rechecked in enforceUser and revokeDevice transaction |
| R4CPC-OIDC-BODY-UNAVAILABLE | oidc | P3 | services/control-plane/src/oidc.ts:99 | A provider key-body transport failure is returned as rejected authentication | real-fixed #1176; Worker regression401 to503 then retry200; merged through CI |
| R4CPC-QUOTA-STALE-SAMPLE | node quota | P2 | services/control-plane/src/ops/quota.ts:288 | Older counters committed after a newer observation create a false reset and double-count usage | real-unfixed issue #1181; coordinated counter observation ordering across retention needed |
| R4CPC-WITHDRAWN-LEDGER-RECOVERY | usage recovery | P2 | services/control-plane/src/exit-identity-roster.ts:47 | Missing exit ledger rebills retained counters for users omitted from eligible roster | duplicate of #1069 / merged #1180; own duplicate #1182 closed |
| R4CPC-CLOSE-REPLACEMENT | product account | P2 | services/control-plane/src/ops/shared-admin/catalog.ts:83 | Concurrent account replacement escapes close and remains billable | real-fixed #1186; actual Worker close retires replacement and records its event; merged through CI |
| R4CPC-USAGE-BATCH-PARTIAL | usage | P2 | services/control-plane/src/index.ts:3423 | Partial billing writes on ingest failure | false-positive all source and account writes use one transactional D1 batch |
| R4CPC-USAGE-CUTOVER-RACE | usage | P2 | services/control-plane/src/index.ts:3425 | Stale dual-phase preflight might commit after cutover | false-positive phase and legacy liveness triggers abort the full stale batch |
| R4CPC-USAGE-REMOVED-DEVICE-FINAL | usage | P2 | services/control-plane/src/index.ts:3419 | Removed device final usage might be discarded | false-positive ingest requires existing user and accepts queued final traffic without a live device |
| R4CPC-USAGE-V2-TIED-AT | usage | P2 | services/control-plane/src/index.ts:3563 | Same-second reports might discard legitimate growth | false-positive agents persist strictly increasing observation stamps; duplicate observation rejection is intentional |
| R4CPC-QUOTA-STALE-OVERWRITE | node quota | P2 | services/control-plane/src/ops/quota.ts:322 | Absolute stale write alone might permanently double-count usage | false-positive next monotonic cumulative read self-heals; actual false reset is recorded separately |
| R4CPC-CONFIRM-OTHER-DEVICE | devices | P2 | services/control-plane/src/index.ts:1992 | Session might confirm another installation on same account | false-positive claim binds authenticated installation ID and unique user/installation pair |
| R4CPC-QUOTA-MINUTE-PAIR | node quota ingest | P2 | services/control-plane/src/ops-timeseries.ts:132 | Incomplete observation erases a complete pair in the same minute and fabricates a quota reset | real-fixed #1183; regression preserves complete pair and real resets; merged through CI |
| R4CPC-ASSIGN-POOLED-RACE | product account | P2 | services/control-plane/src/product-account.ts:274 | Concurrent pooled assignments might allocate twice | false-positive pooled-state guard, changes chain, and unique assigned-user index fence loser |
| R4CPC-REPLACE-RETIRE-GAP | product account | P2 | services/control-plane/src/product-account.ts:397 | Failed replacement might retire current account without successor | false-positive D1 batch rolls retirement back with failing successor insertion |
| R4CPC-QUOTA-RETRY-DELTA | node quota | P2 | services/control-plane/src/ops/quota.ts:305 | Failed quota update or retention retry might duplicate usage | false-positive retry recomputes from unchanged baseline, or adds zero after committed update |
| R4CPC-CLAUDE-BAN-ADMISSION | product account | P2 | services/control-plane/src/product-account.ts:342 | Banning a Claude inventory account might fail to disable VPN user | false-positive inventory product ban and VPN user eligibility intentionally have separate semantics |
| R4CPC-LATE-BEARER-RENEWAL | sessions | P2 | services/control-plane/src/sessions.ts:79 | Delayed bearer rejection might invalidate successor credentials | false-positive clients coalesce renewals and track current bearer; clock variant already covered by #990 |
| R4CPC-CONFIRM-EXPIRY | devices | P2 | services/control-plane/src/index.ts:2152 | Promotion crossing plan expiry might preserve admission | false-positive account-filtered rosters and auth apply expiry; no distinct effect beyond eventual cleanup proved |
| R4CPC-OVERSIZE-DRAIN | request | P2 | services/control-plane/src/request.ts:54 | Oversized-body drain might hang a customer machine | false-positive drain is deliberate Worker body-lifecycle handling; no machine hang path proved |
| R4CPC-ACCESS-BODY-UNAVAILABLE | access auth | P3 | services/control-plane/src/access.ts:112 | Key-body transport outage is returned as expired Access authentication | real-fixed #1190; Worker regression401 to503 then same assertion200; merged through CI |
| R4CPC-QUOTA-NOSAMPLE | node quota | P2 | services/control-plane/src/ops/quota-unsampled.ts:41 | Unsampled initial quota could bill lifetime counters | duplicate fixed by #904 null baseline |
| R4CPC-QUOTA-ROLLOVER | node quota | P2 | services/control-plane/src/ops/quota-cycle.ts:86 | Failed successor insert could leave no open cycle | duplicate fixed by #852 transactional replacement |
| R4CPC-QUOTA-RETENTION | node quota | P2 | services/control-plane/src/ops/quota.ts:425 | Incomplete retained pairs could rewind quota counters | duplicate fixed by #1015 complete-pair retention; raw overwrite distinct |
| R4CPC-LEGACY-CUTOVER | usage | P1 | services/control-plane/src/ops/shared-admin/usage-metering.ts:161 | Cutover forgives quiet-window named growth | duplicate of known issue #4 product decision |
| R4CPC-COUNTER-GENERATION | usage | P2 | services/control-plane/src/index.ts:3531 | Counter resets above prior watermark cannot be distinguished numerically | duplicate of known issue #5 generation semantics |
| R4CPC-V1-REPORT-REPLAY | usage | P2 | services/control-plane/src/index.ts:3484 | Legacy report replay after reset and evidence retention | duplicate already-known v1 report replay; not re-reported |
| R4CPC-GOOGLE-EMAIL-LINK | oidc | P2 | services/control-plane/src/index.ts:930 | Google non-authoritative verified email can auto-link existing account | duplicate known issue #789 latent product decision |
| R4CPC-REVOCATION-CONFIRM-DELETE | devices | P2 | services/control-plane/src/index.ts:1670 | Revocation deletion might race successful new confirmation | false-positive unfinished-job issuance/store guards prevent rebinding; live pending claims defer deletion |
| R4CPC-ENROLLMENT-REVOKE-RACE | devices | P2 | services/control-plane/src/index.ts:2660 | Stale re-enrollment request might issue after device removal | false-positive issuance UPDATE requires current pending status, live TTL and no unfinished revocation job |
| R4CPC-OIDC-CONCURRENT-CONSUME | oidc | P2 | services/control-plane/src/index.ts:2361 | Parallel OIDC verifies might both authenticate one challenge | false-positive consumption CAS requires consumed_at IS NULL; reserved valid-attempt TOCTOU regression covers failed competitors |
| R4CPC-ROUTING-OWNER-REPLAY | account telemetry | P2 | services/control-plane/src/index.ts:2511 | Research snapshot replay might cross account or device ownership | false-positive owner hash, authenticated device binding and canonical JSON conflict check fence replay |
| R4CPC-PROMOTION-TARGET | devices | P2 | services/control-plane/src/index.ts:1443 | Submitted node identifiers might choose another promotion target | false-positive inventory pending tag, server enrollment hostname, exact IPs, verified key and unique candidate select server management ID |
| R4CPC-STABLE-ID-USAGE | usage attribution | P2 | services/control-plane/src/index.ts:1469 | Unverified stable ID might redirect usage billing | false-positive home-agent treats stable ID as audit metadata and attributes usage by verified public key; duplicate keys rejected |
| R4CPC-AUTH-METHOD-DISPATCH | auth | P2 | services/control-plane/src/index.ts:2215 | Auth-method discovery or wrong-method dispatch might expose writes | false-positive discovery publishes public configuration only; mutation routes require exact POST and public system routes exact GET |
| R4CPC-FP-RESEARCH-SHAPE | request parsing | P2 | services/control-plane/src/index.ts:126 | Malformed research payload might crash parsing | false-positive object and key validation precedes access; counts, duplicates and aggregates are bounded |
| R4CPC-FP-ACTION-RESULT-BUDGET | account telemetry | P2 | services/control-plane/src/index.ts:419 | Normal client action result might exceed the accepted size | false-positive Mac client deliberately caps LocalTrafficAudit entries at two so supported result fits 2 KiB |
| R4CPC-FP-ROUTE-DOUBLECOUNT | account telemetry | P2 | services/control-plane/src/index.ts:545 | Repeated cumulative telemetry might double-count routes | false-positive parser uses newest event generation and MAX cumulative count per route |
| R4CPC-FP-TELEMETRY-CONFIRMED | account telemetry | P2 | services/control-plane/src/index.ts:560 | Periodic telemetry might falsely confirm protection | false-positive periodic evidence remains inconclusive; confirmed action requires connected PF TUN DNS identity and blocked-bypass proof |
