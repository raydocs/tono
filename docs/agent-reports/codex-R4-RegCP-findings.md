# R4-RegCP: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 00:15 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1065 | hunt/sol-r4cp-retirement-timeout | needs-hardware | yes | fix(exit-agent): preserve revocation inventory after config validation timeout |
| 1080 | hunt/sol-r4cp-retire-relist-fence | needs-hardware | yes | fix(control-plane): fence retirement token cleanup against concurrent relist |
| 1091 | hunt/sol-r4cp-ledger-cache | none | yes | fix(control-plane): invalidate ledger page validators after edits |
| 1096 | hunt/sol-r4cp-nested-reversal | none | yes | fix(control-plane): preserve source totals through nested ledger reversals |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| REG-800 | control-plane/auth | — | services/control-plane/src/index.ts:2464 | Logout recursively revokes live successors through revoked chain rows | ok |
| REG-832 | control-plane/catalog | — | services/control-plane/src/ops/retire-dependencies.ts:66 | HY2 selections drain under the base exit identity; normalized occupancy preserves pending incident | ok |
| REG-821 | control-plane/releases | — | services/control-plane/src/releases/host.ts:113 | R2 byte-range bodies stream on both installer surfaces with unchanged byte headers | ok |
| REG-797 | control-plane/policy | — | services/control-plane/src/traffic-policy.ts:274 | All direct hostname surfaces reject assistant suffixes and parent overlaps even when signed | ok |
| REG-716 | control-plane/ops-auth | — | services/control-plane/src/ops/access-roles.ts:95 | Shared-admin and legacy entry gates cover routes and default unknown resources to owner | ok |
| REG-713 | control-plane/admin | — | services/control-plane/admin/src/pages/ControlPage.tsx:1 | Legacy catalog editor now read-only; links target the current publisher without Worker contract change | ok |
| REG-970 | control-plane/ops-auth | — | services/control-plane/src/ops/handlers/nodes.ts:292 | Catalog jobs have stricter action checks after delegated generic job gate | ok |
| REG-938 | control-plane/ops-http | — | services/control-plane/src/ops/http.ts:21 | Unicode cursor limits cover the maximum supported node names with colon-safe percent encoding | ok |
| REG-959 | control-plane/preview | — | services/control-plane/preview/config.mjs:138 | Current committed production D1 UUID rejected case-insensitively before rendering both Workers | ok |
| REG-857 | control-plane/parsers | — | services/control-plane/test/parser-properties.test.ts:30 | Generated tests are bounded; product parser behavior unchanged; lock dependency set remains consistent | ok |
| R4CP-AUTH-REFRESH-LOGOUT | control-plane/auth | — | services/control-plane/src/index.ts:2464 | Concurrent refresh successor escapes logout | false-positive recursive CTE handles revoked intermediates; #856 duplicate of merged #800 |
| R4CP-CATALOG-INLINE-HY2 | control-plane/catalog | — | services/control-plane/src/catalog-yaml.ts:733 | Retirement leaves one HY2 alias in inline proxy-group members | false-positive no user-facing owned-app path: macOS imports only proxy definitions and Windows validates proxies while ignoring groups; possible engineering cleanup only |
| R4CP-DEFAULT-PROXY-RETIRE | control-plane/catalog | — | services/control-plane/src/ops/reads/fleet.ts:272 | Retiring a configured default proxy prevents refreshed catalog admission | false-positive both clients deliberately sanitize missing default selection hints; only missing required residential hop rejects admission |
| R4CP-DIAGNOSTICS-UNICODE | control-plane/diagnostics | P2 | services/control-plane/src/telemetry/diagnostics.ts:90 | Unicode catalog names could break shipped-app diagnostics bundle uploads | false-positive no shipped app produces this new bundle API; nodeId contract is not proved to be a catalog display name |
| R4CP-RETIRE-RELIST-FENCE | control-plane/catalog | P2 | services/control-plane/src/ops/reads/fleet.ts:270 | Immediate retirement cleanup disables token after a concurrent relist succeeds | real-fixed #1080; closes issue #1072 |
| R4CP-OPEN833-CAS-SIBLINGS | control-plane/auth | P2 | services/control-plane/src/sessions.ts:43 (PR #833) | A losing refresh CAS in proposed #833 may revoke the winning successor | false-positive latest #833 now gates sibling UPDATE on this request successor_id; prior unmerged snapshot concern resolved |
| REG-758 | control-plane/devices | — | services/control-plane/src/index.ts:1032 | All six revocation-job reopen paths reset retry stamp while keeping generation-scoped completion | ok |
| R4CP-REVOCATION-DELETE-CLAIM | control-plane/devices | — | services/control-plane/src/index.ts:1712 | A concurrent confirm adopts a target while prior Tailscale DELETE is awaiting | false-positive pending job fences management-id store and enrollment; final activation checks claim lease; reopened completion uses ownership_generation |
| R4CP-AUTHRESULT-LATE-REVOKE | control-plane/auth | — | services/control-plane/src/index.ts:1009 | Session insertion after ensureDevice or enrollment could revive a revoked device | false-positive migration0035 sessions_require_eligible_device validates user and device in SQLite INSERT boundary; rotate/expiration revoke existing sessions atomically |
| R4CP-PENDING-EXPIRE-EMPTY-ID | control-plane/devices | — | services/control-plane/src/index.ts:1052 | Expiration snapshot without a management id misses a concurrent stored identity outbox | false-positive same-generation expiry can only win before promotion guard; status/claim checks prevent promotion and orphan pending-node sweep covers leftover pending-tag nodes |
| REG-780 | metering/exit-agent | — | services/exit-agent/reconcile_and_report.py:1199 | restart absent-label baseline reset and ACK inventory persistence compose correctly with later fixes | ok |
| REG-838 | exit-agent | — | services/exit-agent/reconcile_and_report.py:1169 | known inventory survives Refusal after partial mutation and counter read | ok |
| REG-914 | exit-agent/control-plane | P2 | services/exit-agent/reconcile_and_report.py:1281 | lost ledger recovery omits expired users historical counter labels because source watermark DTO only returns active roster identities | issue #1069 |
| REG-1009 | exit-agent | P1 | services/exit-agent/reconcile_and_report.py:1504 | CLI exception catches miss static-retirement config validation timeout after accepted additions | regression-fixed #1065 |
| REG-899 | home-agent | — | services/home-agent/report_example.py:619 | permanent usage refusals isolate one account while retryable delivery failures preserve queue | ok |
| REG-852 | node quotas | — | services/control-plane/src/ops/quota-cycle.ts:85 | atomic rollover preserves old counter baselines on successor insert failure | ok |
| REG-904 | node quotas | — | services/control-plane/src/ops/quota-unsampled.ts:37 | unsampled profile save establishes null counters and first measured read counts no historical usage | ok |
| REG-825 | ops quotas | — | services/ops-console/src/lib/node-detail.ts:304 | fractional GB quota retains ordinary allowances through unrelated saves | ok |
| REG-805 | ops quotas | — | services/ops-console/src/lib/node-detail.ts:331 | UTC anchor extraction now matches cycle zone | ok |
| REGCP-MISSING-EXPIRED-WATERMARK | exit-agent/control-plane | P2 | services/exit-agent/reconcile_and_report.py:1239 | Lost ledger recovery replays counters for inactive users omitted from source watermarks | real-unfixed issue #1069; needs recovery API/agent contract change |
| R4CP-RETIRE-VALIDATION-TIMEOUT | exit-agent | P1 | services/exit-agent/reconcile_and_report.py:1504 | Static retirement CLI timeout skips inventory durability and later revocation misses installed client | real-fixed #1065 |
| REGCP-V2-SEQUENCE-LOSS | metering agents | P2 | services/exit-agent/reconcile_and_report.py:1945 | loss of monotonic observation clock after ledger loss could suppress next report | false-positive ordinary timer next server observation is newer; requires clock rollback or same-second manual race |
| REGCP-HOME-REFUSAL-LOST-DELTA | home-agent | P2 | services/home-agent/report_example.py:626 | refused report does not advance totals while peer baseline already advanced | false-positive deliberate permanent-refusal policy; rejected delta dropped by design |
| REGCP-SPECULATIVE-TIMEOUT-INVENTORY | exit-agent | P2 | services/exit-agent/reconcile_and_report.py:1157 | timeout catch adds roster label even if temp-file failure happened before Xray RPC | false-positive conservative candidate; later not-found removal succeeds safely |
| REGCP-QUOTA-ROLLOVER-CONCURRENCY | node quotas | P2 | services/control-plane/src/ops/quota.ts:278 | parallel rollover could contend on open-cycle uniqueness | false-positive failed unique successor batch rolls back; stale concurrent sample ordering remains millisecond race only |
| REG-1015 | node quotas/retention | — | services/control-plane/src/ops-timeseries.ts:303 | complete-pair ranking survives raw and hourly retention while preserving latest actual reset | ok |
| REGCP-STALE-RAW-TIER | node quotas | P2 | services/control-plane/src/ops/quota.ts:423 | Ordinary collector stall could backfill older raw counters and fabricate a quota reset | false-positive ordinary stall repeats latest pair; source harness requires unproven upstream rewind or administrator backfill |
| REGCP-CORRUPT-STATE-REPLAY | exit-agent | P2 | services/exit-agent/reconcile_and_report.py:1808 | corrupted state might be treated like a lost ledger and double bill | false-positive load_state errors leave stateNone; revocation still runs but usage is refused |
| REGCP-PARTIAL-BASELINE-SNAPSHOT | exit-agent | P2 | services/exit-agent/reconcile_and_report.py:1872 | shallow durable inventory snapshot could accidentally persist baseline changes after keep_usage failure | false-positive lifetime_totals replaces baseline only after a successful fold; old snapshot retains original dict |
| REG-1023 | ops-console | — | services/ops-console/src/copy/diagnostics.ts:1 | Diagnostics copy move preserves route names and DTO fields | ok |
| REG-981 | ops-console | — | services/ops-console/src/pages/customer/Destinations.test.tsx:16 | Unchecked-index correction retains attribution assertions | ok |
| REG-969 | ops-console | — | services/ops-console/src/app/CommandPalette.tsx:99 | Private customer/invite command identities remain distinct with displayed-field filtering | ok |
| REG-968 | ops-console | — | services/ops-console/src/pages/customer/Devices.tsx:69 | Initial device standing failure disables unknown log toggle and preserves error | ok |
| REG-965 | ops-console | — | services/ops-console/src/pages/settings/use-document.ts:135 | Publish metadata and history revision invalidation compose with current CAS API | ok |
| REG-957 | ops-console | P2 | services/ops-console/src/pages/today/Quality.tsx:154 | Ledger UTC bucket fix missed new dashboard sibling daily labels | issue #1067 |
| REG-880 | ops-console | — | services/ops-console/src/lib/use-resource.ts:100 | Oldest displayed shared resource governs page freshness | ok |
| REG-869 | ops-console | — | services/ops-console/src/pages/customer/Destinations.tsx:34 | Destination grouping retains route and exit across day aggregation | ok |
| REG-848 | ops-console | — | services/ops-console/src/pages/settings/LedgerDrawer.tsx:99 | Posting-day FX preview matches current server default and historic paidAt remains independent | ok |
| REG-770 | control-plane | — | services/control-plane/src/ops/http.ts:62 | Colon cursor encoding round-trips newly generated customer cursors | ok |
| REG-734 | ops-console | — | services/ops-console/src/pages/diagnostics/CustomerDiagnostics.tsx:13 | Privacy-safe diagnostics panel fields match current Worker DTO | ok |
| R4-OPS-DELETE-BOUND | ops-console | P2 | services/ops-console/src/pages/settings/HomeInventory.tsx:175 | A stale bindings read might allow deleting an exit that now has customers | false-positive: server refuses bound exit deletion |
| R4-OPS-DRAFT-INFLIGHT | ops-console | P2 | services/ops-console/src/pages/settings/use-document.ts:138 | Typing during publication might make online text claim an unpublished draft | false-positive: callback closes over sent draft and later editor text remains distinct |
| R4-OPS-PRIVATE-COMMAND-KEY | ops-console | P3 | services/ops-console/src/app/CommandPalette.tsx:123 | Invite identity contains unmasked address despite privacy preference | false-positive: privacy is display masking; custom filter ignores identity and label stays masked |
| R4-OPS-EXPIRY-LIFECYCLE | ops-console | P2 | services/ops-console/src/lib/customer-board.ts:36 | Expired lifecycle customers disappear from overdue count and lapsed chart | real-unfixed issue #1068; UI changes excluded by hunt scope |
| REG-743 | ops-console | — | services/ops-console/src/components/ops/chart-scale.ts:1 | Chart foundation has finite-domain guards and bounded caller datasets; no action or API-contract change | ok |
| REG-745 | ops-console | P2 | services/ops-console/src/pages/today/Quality.tsx:154 | New overview SLO charts preserve weighted counts but use local labels on UTC daily buckets | issue #1067 |
| REG-746 | ops-console | P2 | services/ops-console/src/pages/node/Quality.tsx:89 | Fleet/node dashboards match current metrics and SLO contracts; daily SLO labels remain local | issue #1067 |
| REG-747 | ops-console | — | services/ops-console/src/pages/settings/HomeInventory.tsx:90 | Inventory/dashboard changes preserve current home-exit status and deletion contracts; server guards bound exits | ok |
| REG-748 | ops-console | P2 | services/ops-console/src/lib/customer-board.ts:36 | Customers dashboard derives overdue counts from impossible fresh active lifecycle rows | issue #1068 |
| REG-737 | ops-console | — | services/ops-console/vite.prototype.config.ts:13 | Prototype build is isolated from production entry and only mock state/actions are wired | ok |
| R4-OPS-UTC-SIBLING | ops-console | P2 | services/ops-console/src/pages/today/Quality.tsx:154 | Quality dashboards render UTC daily SLO buckets with local dates | real-unfixed issue #1067; UI changes excluded by hunt scope |
| REG-766 | control-plane | — | services/control-plane/src/telemetry/failure-clusters.ts:221 | Open-cluster uniqueness loser joins the winner; both join paths preserve monotonic timestamp | ok |
| REG-767 | control-plane | — | services/control-plane/src/ops/ledger.ts:325 | Single reversal cancellation passed; undo of reversal missed and fixed in #1096 | regression-fixed #1096 |
| REG-839 | control-plane | — | services/control-plane/src/ops/ledger.ts:81 | Month snapshot now includes reconciliation; reconFromSnapshot reads it under current close fence | ok |
| REG-865 | control-plane | — | services/control-plane/src/ops/handlers/ledger.ts:270 | Reversal stamp checks immediately preceding INSERT changes inside the same D1 batch | ok |
| REG-883 | control-plane | — | services/control-plane/src/ops/handlers/ledger.ts:331 | Month-close row/subject CAS composes with guarded writes and immutable amounts | ok |
| REG-890 | control-plane | — | services/control-plane/src/ops-timeseries.ts:492 | No-prototype metric map survives constructor/toString/__proto__ through tier stitching and JSON | ok |
| REG-903 | control-plane | — | services/control-plane/src/telemetry/failure-clusters.ts:229 | MAX timestamp applies to both normal and uniqueness-loser join paths | ok |
| REG-918 | control-plane | — | services/control-plane/src/telemetry/diagnostics.ts:355 | Whole validated bundle commits atomically; post-commit clustering failure is contained | ok |
| REG-924 | control-plane | — | services/control-plane/src/telemetry/diagnostics.ts:174 | Completed client session cannot be reopened by delayed start; bundle batch preserves guard | ok |
| REG-931 | control-plane | — | services/control-plane/src/telemetry/diagnostics.ts:178 | Automatic session log excerpt stores null while bounded request validation remains | ok |
| REG-947 | control-plane | — | services/control-plane/src/ops/shared-admin/diagnostics-logs.ts:95 | Expiry DELETE rechecks renewed grant; following audit depends on actual deletion | ok |
| REG-837 | control-plane | — | services/unchecked-index-ratchet.mjs:79 | Unchecked-index ratchet preserves strict pass; current Windows shim fix does not change Linux checks | ok |
| REG-870 | control-plane | — | services/control-plane/vitest.config.ts:86 | Per-file coverage gates remain enforced and full baseline passes all four included runtime files | ok |
| R4CP-LEDGER-NESTED-REVERSAL | control-plane/ledger | P2 | services/control-plane/src/ops/ledger.ts:325 | Reversing a reversal yields CSV source total -800 while CNY correctly totals 800 | real-fixed #1096 |
| R4CP-LEDGER-CLOSE-CAS | control-plane/ledger | P2 | services/control-plane/src/ops/handlers/ledger.ts:331 | Ledger additions or subject moves after month-close snapshot could escape freeze | false-positive current atomic JSON state fence rejects changed rows; writes also check closed month at mutation boundary |
| R4CP-REVERSE-CLOSE-STAMP | control-plane/ledger | P2 | services/control-plane/src/ops/handlers/ledger.ts:270 | Failed reversal insertion can still mark original reversed after month close | false-positive changes() immediately follows guarded INSERT within D1 batch and existing barrier regression still exercises current code |
| R4CP-DIAGNOSTICS-POSTCOMMIT | control-plane/telemetry | P2 | services/control-plane/src/telemetry/diagnostics.ts:359 | Failure clustering exception after bundle insert makes retry duplicate diagnostics | false-positive #918 catches best-effort clustering after committed insert; #903 uses monotonic greatest event time on join paths |
| R4CP-LEDGER-PAGE-VALIDATOR | control-plane/ledger | P3 | services/control-plane/src/ops/handlers/ledger.ts:154 | Successful edit changes ledger page but leaves conditional validator unchanged | real-fixed #1091 |
| REG-1065 | exit-agent | — | services/exit-agent/reconcile_and_report.py:1504 | Validation timeout maps to Refusal after durable accepted inventory; later revocation succeeds | ok |
| REG-1080 | control-plane/catalog | — | services/control-plane/src/ops/reads/fleet.ts:270 | Both immediate revoke callers pass catalog revision and cannot undo newer relist | ok |
| REG-1091 | control-plane/ledger | — | services/control-plane/src/ops/handlers/ledger.ts:154 | DTO digest composes with paging and current ledger writes; unchanged reads still return304 | ok |
| REG-1096 | control-plane/ledger | — | services/control-plane/src/ops/ledger.ts:325 | Nested source polarity and cross-month zero-FX ancestry compose with #1091; final combined suite979 passed | ok |
| REG-1083 | control-plane/catalog | — | services/control-plane/src/ops/reads/fleet.ts:166 | Bound catalog homes and legacy HY2 aliases refuse both direct and queued retirement before catalog/token mutation; #1080 revision fences remain intact | ok |
