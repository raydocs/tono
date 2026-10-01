Operator action: #883 body refresh failed twice with the gh Projects Classic GraphQL error. Branch: hunt/sol-cp-month-close-ledger-fence; title: fix(control-plane): reject stale ledger snapshots during month close; code is already merged; remaining handoff is an optional body refresh. Updated body: [month-close-pr-body.md](/workspace/w1-codex/out/W1-sol-cp/month-close-pr-body.md).

12 verified fixes merged through CI; no deployment/publication or native network operation. Paths below are relative to services/control-plane unless they start with tooling/. Line references identify audited failure paths.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| SOL-C5-RELEASE-RANGE-BUFFER | C5 | P2 | src/releases/host.ts:118 | Legacy ranged installer GET buffers and copies selected body | real-fixed #821 |
| SOL-CP-CLUSTER-LAST-SEEN | C6 | P2 | src/telemetry/failure-clusters.ts:237 | Delayed events rewind last_seen and split active outage | real-fixed #903 |
| SOL-CP-CURSOR-UNICODE-LIMIT | C7a | P2 | src/ops/http.ts:22 | Accepted long Unicode node names exceed encoded cursor bounds or token parser cap | real-fixed #938 |
| SOL-CP-DIAGNOSTICS-PARTIAL | C6 | P2 | src/telemetry/diagnostics.ts:156 | Invalid later array entry returns 400 after earlier diagnostic rows commit | real-fixed #918 |
| SOL-CP-EXCERPT-PRIVACY | C6 | P2 | src/telemetry/diagnostics.ts:151 | Privacy-safe excerpt intake preserves complete IPv6 addresses and tokens | real-fixed #931 |
| SOL-CP-HY2-RETIRE-DRAIN | C7b | P1 | src/ops/retire-dependencies.ts:64 | Retirement misses recent HY2 clients and revokes exit admission before drain | real-fixed #832 |
| SOL-CP-LEDGER-CLOSE-RACE | C7b | P2 | src/ops/handlers/ledger.ts:323 | Close can freeze a summary missing a ledger write accepted during reads | real-fixed #883 |
| SOL-CP-LOG-RENEW-SWEEP | C7a | P2 | src/ops/shared-admin/diagnostics-logs.ts:96 | Expired-window sweep can delete a renewed grant | real-fixed #947 |
| SOL-CP-METRICS-NAME | C6 | P2 | src/ops-timeseries.ts:479 | Valid node constructor collides with inherited object key and metrics throws | real-fixed #890 |
| SOL-CP-MONTH-RECON-SNAPSHOT | C7b | P2 | src/ops/ledger.ts:80 | Closed month omits frozen reconciliation snapshot | real-fixed #839 |
| SOL-CP-REVERSE-CLOSE-RACE | C7b | P2 | src/ops/handlers/ledger.ts:273 | Close racing reversal leaves dangling reversed_by despite rejected INSERT | real-fixed #865 |
| SOL-CP-SESSION-REWIND | C6 | P2 | src/telemetry/diagnostics.ts:162 | Retried beginning payload clears completed-session fields and bytes | real-fixed #924 |
| SOL-CP-ADMIN-HY2-IDENTITY | C9 | P2 | admin/src/lib/catalog.ts:31 | Legacy console creates second machine identity for hy2 block | real-unfixed deferred under requested UI restriction; runtime proved |
| SOL-CP-ADMIN-REFRESH-DEFAULT | C9 | P2 | admin/src/hooks.tsx:213 | Absent localStorage key disables default auto-refresh | real-unfixed deferred under requested UI restriction; runtime proved |
| SOL-CP-ADMIN-USERS-PAGE | C9 | P3 | admin/src/api.ts:685 | Legacy user client ignores pagination beyond 2000 customers | real-unfixed deferred under requested UI restriction; scaling-only |
| SOL-CP-HOME-PASTE-PASSWORD | C7a/C5 | P2 | src/ops/shared-admin/home-exits.ts:178 | Pasting same home tuple with different pasted password keeps old password unless flagged | real-unfixed decision item: shared credential authority/rotation semantics; automatic replacement could overwrite a newer shared secret |
| SOL-CP-ONBOARD-ROLE | C7a | P2 | src/ops/legacy-handlers/users.ts:267 | Operator onboarding internally edits inventory owner-gated by #716 | real-unfixed decision item: onboarding inventory rights overlap #716 policy |
| SOL-CP-PROFILE-PORT | C7b | P3 | src/ops/handlers/nodes-profile.ts:107 | Documented profile port is validated then discarded | real-unfixed decision item: persisted profile schema has no port field |
| SOL-CP-ADMIN-DRAFT-RACE | C9 | — | admin/src/pages/ControlPage.tsx:241 | Dirty editor might bypass discard confirmation | duplicate #713 removes legacy editor |
| SOL-CP-AUTH-GATES | C7a | P2 | src/index.ts:2928 | Shared-admin and legacy reads bypass role authorization | duplicate #716 / H4-F3 |
| SOL-CP-CLUSTER-OPEN-RACE | C6 | P2 | src/telemetry/failure-clusters.ts:217 | Concurrent cluster opens may collide | duplicate fixed #766 |
| SOL-CP-CURSOR-LONG-EMAIL | C7a/C7b | P2 | src/ops/http.ts:23 | Cursor sort key rejects valid long customer email at page boundary | duplicate of #770 merged cursor bound expansion |
| SOL-C5-FLOW-REFERENCES | C5 | — | src/catalog-yaml.ts:694 | Retirement leaves dangling hy2 member in flow-style group | false-positive no verified client effect; desktop clients build routing from admitted nodes |
| SOL-C5-HY2-EMPTY | C5 | — | src/catalog.ts:220 | Empty HY2 allow list admits declared clients | false-positive later owner decision requires all-user hy2; worker regression explicitly expects this |
| SOL-C5-RANGE-PARSER | C5 | — | src/http.ts:1 | Suffix and oversized ranges might break release downloads | false-positive suffix/clamp/finite guards already correct; invalid Range ignored as permitted |
| SOL-CP-ACCESS-SPOOF | C7a | — | src/access.ts:138 | Access header might impersonate administrator | false-positive signature issuer audience expiry and email allowlist verified |
| SOL-CP-ACTION-RAW-READ | C7a | — | src/index.ts:604 | Administrative action listings might expose raw host samples | false-positive aggregate sanitizer |
| SOL-CP-ADMIN-BILLING-URL | C9 | — | admin/src/pages/monitor/NodeDrawer.tsx:248 | Billing link might execute javascript | false-positive server requires HTTPS |
| SOL-CP-ADMIN-CSRF | C7a | — | src/admin-worker.ts:80 | Admin binding strips Origin before API authorization | false-positive request provenance checked before stripping |
| SOL-CP-ADMIN-DETAIL-RACE | C9 | — | admin/src/pages/users/CustomerDrawer.tsx:160 | Late previous-customer detail might replace drawer | false-positive response binding/keyed account fence |
| SOL-CP-ADMIN-DEV-FALLBACK | C9 | — | admin/src/api.ts:527 | Fixture might pretend production write succeeded | false-positive development-only fallback |
| SOL-CP-ADMIN-DOUBLE-MUTATION | C9 | — | admin/src/pages/users/ask.tsx:29 | Double confirmation might repeat destructive actions | false-positive exclusive gate and server guards |
| SOL-CP-ADMIN-STALE-HEALTH | C9 | — | admin/src/lib/source-truth.ts:60 | HTTP success might show stale collector as healthy | false-positive source age checked |
| SOL-CP-ADMIN-URL-PII | C9 | — | admin/src/pages/UsersPage.tsx:48 | Privacy-mode search might persist email in URL | false-positive privacy mode clears hash search |
| SOL-CP-API-CSRF | C7a | — | src/index.ts:3745 | Direct API operations may accept browser state-changing requests | false-positive foreign Origin rejected; Access JWT still required |
| SOL-CP-CATALOG-LOST-WRITE | C7a | — | src/ops/shared-admin/catalog.ts:147 | Concurrent catalog/policy publish might overwrite newer revision | false-positive conditional revision UPDATE and checked changes |
| SOL-CP-DIAGNOSTICS-IDOR | C7a | — | src/ops/shared-admin/diagnostics-logs.ts:146 | Mismatched customer/device might open another customer raw-log window | false-positive device ownership WHERE and DB owner trigger |
| SOL-CP-FP-AI-CONSENT | C6 | — | src/telemetry/diagnostics.ts:316 | AI routing facts might be stored without consent | false-positive consent guard precedes inserts |
| SOL-CP-FP-AUDIT-RETRY | C7b | — | src/product-account.ts:175 | Audit error might turn committed mutation into failed retry | false-positive audit errors caught |
| SOL-CP-FP-CORE-STDERR | C6 | — | tooling/scripts/core-helper/CoreManager.swift:291 | Automatic failure report might expose arbitrary core stderr | false-positive synthetic exit status only |
| SOL-CP-FP-CORRUPT-JSON | C6 | — | src/telemetry-window.ts:197 | Normal ingestion might create corrupt stored JSON | false-positive canonical JSON.stringify writes |
| SOL-CP-FP-COUNT | C6 | — | src/telemetry/failure-clusters.ts:237 | Concurrent cluster joins might lose increments | false-positive atomic event_count increment |
| SOL-CP-FP-DIAGNOSTICS-IDOR | C6 | — | src/telemetry/diagnostics-read.ts:250 | deviceId filter might expose another customer diagnostics | false-positive user_id and device_id constraints |
| SOL-CP-FP-FX-OVERFLOW | C7b | — | src/ops/fx.ts:62 | Extreme upstream FX might overflow integer money | false-positive no supported-rate trigger; pathological upstream required |
| SOL-CP-FP-HOME-CYCLE | C7b | — | src/ops/home-lines.ts:175 | Inclusive cycle end might double-count billing boundary | false-positive function has no runtime caller |
| SOL-CP-FP-HY2-MARGIN | C7b | — | src/ops/ledger.ts:223 | HY2 alias might yield confidently wrong customer margin | false-positive missing cost marks pending and null margin |
| SOL-CP-FP-LAST-HY2-NODE | C5/C7b | — | src/catalog-yaml.ts:654 | HY2 second block might allow retiring sole node | false-positive callee requires remaining proxy blocks |
| SOL-CP-FP-METRIC-FIELDS | C6 | — | src/ops/legacy-handlers/metrics.ts:21 | Unknown metric fields might generate malformed SQL | false-positive fields rejected before query |
| SOL-CP-FP-MIGRATION-PREFIX | C8 | — | migrations/README.md:11 | Repeated numeric prefixes might skip migrations | false-positive filename ordering deliberate; all 83 apply |
| SOL-CP-FP-ORPHAN-DROP | C8 | — | migrations/0070_drop_orphan_diagnostics_and_destination_tables.sql:1 | Dropped table might contain current live data | false-positive deliberate obsolete table retirement; no readers |
| SOL-CP-FP-PROD-WIPE | C8 | — | tooling/scripts/wipe-d1-in-order.mjs:16 | Production wipe might bypass guard by DB ID | false-positive normal production refused; bypass requires local admin |
| SOL-CP-FP-PRODUCT-FK | C8 | — | migrations/0023_ops_management.sql:30 | User deletion SET NULL might conflict with assigned-account CHECK | false-positive no runtime user DELETE; close disables |
| SOL-CP-FP-READ-WRITE | C6 | — | src/telemetry/routes.ts:484 | Read token might write cluster diagnostics | false-positive GET-only routes |
| SOL-CP-FP-REBUILD-CASCADE | C8 | — | migrations/0017_expand_routing_research_payload.sql:1 | Table rebuild might cascade-delete live child data | false-positive relevant tables have no children; fields copied |
| SOL-CP-FP-SESSION-BACKFILL | C7b | — | src/ops/customers-sessions.ts:59 | Backfill might resurrect expired retained sessions | false-positive no runtime caller |
| SOL-CP-FP-UNBOUNDED | C6 | — | src/telemetry/diagnostics.ts:14 | Diagnostics inputs might permit unbounded allocation | false-positive request and array/field bounds |
| SOL-CP-PREVIEW-PROD-DATA | C9 | — | preview/config.mjs:128 | Preview might reuse production database | false-positive requires operator misconfiguration/deployment; render does no deployment |
| SOL-CP-PRODUCT-DOUBLE-ASSIGN | C7a | — | src/product-account.ts:330 | Concurrent pooled product assignment might double-apply entitlement | false-positive atomic conditional D1batch and unique assigned-user index |
| SOL-CP-PUBLIC-STALE-FEED | C9 | — | public/releases/manifest.json:4 | Public feed versions lag current source | false-positive intentionally last-published baseline |
| SOL-CP-ROLE-DEFAULT | C7a | — | src/ops/roles.ts:109 | Malformed or missing OPS_ROLES maps Access users to owner | false-positive explicit compatibility contract docs/ops/api-contract.md:156 and tests |

| PR | Change | State | Auto-merge | Labels |
|---|---|---|---|---|
| [#821](https://github.com/raydocs/tono/pull/821) | fix(control-plane): stream legacy installer byte ranges | MERGED | yes (merge commit) | — |
| [#832](https://github.com/raydocs/tono/pull/832) | fix(control-plane): drain hy2 customers before retiring their node | MERGED | yes (merge commit) | needs-hardware |
| [#839](https://github.com/raydocs/tono/pull/839) | fix(control-plane): freeze month-end reconciliation with its snapshot | MERGED | yes (merge commit) | — |
| [#865](https://github.com/raydocs/tono/pull/865) | fix(control-plane): stamp reversal only after its insert succeeds | MERGED | yes (merge commit) | — |
| [#883](https://github.com/raydocs/tono/pull/883) | fix(control-plane): reject stale ledger snapshots during month close | MERGED | yes (merge commit) | — |
| [#890](https://github.com/raydocs/tono/pull/890) | fix(control-plane): handle prototype-key node names in metrics | MERGED | yes (merge commit) | — |
| [#903](https://github.com/raydocs/tono/pull/903) | fix(control-plane): preserve cluster timestamps on delayed reports | MERGED | yes (merge commit) | — |
| [#918](https://github.com/raydocs/tono/pull/918) | fix(control-plane): commit validated diagnostic bundles atomically | MERGED | yes (merge commit) | — |
| [#924](https://github.com/raydocs/tono/pull/924) | fix(control-plane): retain completed sessions on delayed start uploads | MERGED | yes (merge commit) | — |
| [#931](https://github.com/raydocs/tono/pull/931) | fix(control-plane): omit arbitrary automatic diagnostic log excerpts | MERGED | yes (merge commit) | — |
| [#938](https://github.com/raydocs/tono/pull/938) | fix(control-plane): page supported Unicode node names safely | MERGED | yes (merge commit) | — |
| [#947](https://github.com/raydocs/tono/pull/947) | fix(control-plane): preserve renewed grants during log expiry cleanup | MERGED | yes (merge commit) | — |

38 false positives / 60 hypotheses. Four duplicates. Six unfixed items are the three product/schema decisions and three excluded legacy UI behaviors.

Each fix has a regression that failed on original source and passed afterward. All 12 PRs merged through CI with auto-merge configured for merge commits. Final combined-main validation at 03b5a8ea8297945d1604c7f30fa2502f639b4136: Node24 npm ci, npm run typecheck and npm test passed (46 files / 967 tests). Both indexed-access ratchets pass (521/521 and 99/99). The gate caught one unchecked access in our earlier bundle fixture; an explicit fixture guard fixed it without changing assertions or baselines. Logs: [typecheck](/workspace/w1-codex/out/W1-sol-cp/final-main-typecheck.log), [tests](/workspace/w1-codex/out/W1-sol-cp/final-main-tests.log).

Coverage limits: Assigned C5–C9 runtime files and 83 SQL migrations reviewed; C9 CSS/SVG styling not audited. No production data/deployment, real hardware, Swift or Windows-only Rust execution. Decision/UI items remain unfixed as requested; previously corrupted records are not automatically repaired.
