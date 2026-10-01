Operator handoff: **#883’s optional PR-body refresh failed twice** with the `gh` Projects Classic error. Its code is already merged. Branch: `hunt/sol-cp-month-close-ledger-fence`; title: “fix(control-plane): reject stale ledger snapshots during month close”; updated body: [month-close-pr-body.md](/workspace/w1-codex/out/W1-sol-cp/month-close-pr-body.md).

**12 verified fixes merged through CI.** Final validation on main `03b5a8ea`: `npm ci`, typecheck, and **46 test files / 967 tests passed**. Each fix had a failing-then-passing regression.

Paths below are relative to `services/control-plane`, except `tooling/` paths. Lines identify the audited failure paths.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| SOL-C5-RELEASE-RANGE-BUFFER | C5 | P2 | src/releases/host.ts:118 | Ranged installer response buffers and copies the body | Fixed #821 |
| SOL-CP-HY2-RETIRE-DRAIN | C7b | P1 | src/ops/retire-dependencies.ts:64 | Retirement misses HY2 clients and revokes admission before drain | Fixed #832 |
| SOL-CP-MONTH-RECON-SNAPSHOT | C7b | P2 | src/ops/ledger.ts:80 | Closed month lacks frozen reconciliation | Fixed #839 |
| SOL-CP-REVERSE-CLOSE-RACE | C7b | P2 | src/ops/handlers/ledger.ts:273 | Rejected reversal leaves dangling `reversed_by` | Fixed #865 |
| SOL-CP-LEDGER-CLOSE-RACE | C7b | P2 | src/ops/handlers/ledger.ts:323 | Close omits a concurrently accepted ledger write | Fixed #883 |
| SOL-CP-METRICS-NAME | C6 | P2 | src/ops-timeseries.ts:479 | Prototype-key node names cause metrics 500s | Fixed #890 |
| SOL-CP-CLUSTER-LAST-SEEN | C6 | P2 | src/telemetry/failure-clusters.ts:237 | Delayed events rewind timestamps and split an outage | Fixed #903 |
| SOL-CP-DIAGNOSTICS-PARTIAL | C6 | P2 | src/telemetry/diagnostics.ts:156 | Invalid bundles return 400 after partially committing | Fixed #918 |
| SOL-CP-SESSION-REWIND | C6 | P2 | src/telemetry/diagnostics.ts:162 | Retried start payload clears completed-session facts | Fixed #924 |
| SOL-CP-EXCERPT-PRIVACY | C6 | P2 | src/telemetry/diagnostics.ts:151 | Automatic excerpts preserve arbitrary addresses and tokens | Fixed #931 |
| SOL-CP-CURSOR-UNICODE-LIMIT | C7a | P2 | src/ops/http.ts:22 | Supported Unicode names exceed cursor limits | Fixed #938 |
| SOL-CP-LOG-RENEW-SWEEP | C7a | P2 | src/ops/shared-admin/diagnostics-logs.ts:96 | Expiry cleanup deletes concurrently renewed grants | Fixed #947 |
| SOL-CP-HOME-PASTE-PASSWORD | C7a/C5 | P2 | src/ops/shared-admin/home-exits.ts:178 | Different pasted password retains the existing shared secret | Real-unfixed: credential authority/rotation decision |
| SOL-CP-ONBOARD-ROLE | C7a | P2 | src/ops/legacy-handlers/users.ts:267 | Operator onboarding edits otherwise owner-gated inventory | Real-unfixed: onboarding authorization decision |
| SOL-CP-PROFILE-PORT | C7b | P3 | src/ops/handlers/nodes-profile.ts:107 | Profile port is validated then discarded | Real-unfixed: persistence/schema decision |
| SOL-CP-ADMIN-REFRESH-DEFAULT | C9 | P2 | admin/src/hooks.tsx:213 | Missing preference disables default polling | Real-unfixed: requested UI restriction |
| SOL-CP-ADMIN-HY2-IDENTITY | C9 | P2 | admin/src/lib/catalog.ts:31 | Legacy console treats HY2 block as another machine | Real-unfixed: requested UI restriction |
| SOL-CP-ADMIN-USERS-PAGE | C9 | P3 | admin/src/api.ts:685 | Legacy client ignores pagination beyond 2,000 customers | Real-unfixed: requested UI restriction |
| SOL-CP-AUTH-GATES | C7a | P2 | src/index.ts:2928 | Shared-admin/legacy role gaps | Duplicate #716 |
| SOL-CP-CURSOR-LONG-EMAIL | C7a/C7b | P2 | src/ops/http.ts:23 | Long email exceeds cursor bounds | Duplicate #770 |
| SOL-CP-CLUSTER-OPEN-RACE | C6 | P2 | src/telemetry/failure-clusters.ts:217 | Concurrent cluster opens collide | Duplicate #766 |
| SOL-CP-ADMIN-DRAFT-RACE | C9 | — | admin/src/pages/ControlPage.tsx:241 | Dirty editor discard behavior | Duplicate #713 |
| SOL-C5-HY2-EMPTY | C5 | — | src/catalog.ts:220 | Empty allow-list admits HY2 clients | False positive: later owner decision explicitly permits it |
| SOL-C5-RANGE-PARSER | C5 | — | src/http.ts:1 | Suffix/oversized ranges mishandled | False positive: existing finite/clamp guards work |
| SOL-C5-FLOW-REFERENCES | C5 | — | src/catalog-yaml.ts:694 | Flow groups retain removed HY2 references | False positive: no verified managed-client effect |
| SOL-CP-ROLE-DEFAULT | C7a | — | src/ops/roles.ts:109 | Missing role map defaults to owner | False positive: documented compatibility contract |
| SOL-CP-ACCESS-SPOOF | C7a | — | src/access.ts:138 | Spoofed Access header impersonates admin | False positive: JWT and allow-list verified |
| SOL-CP-ADMIN-CSRF | C7a | — | src/admin-worker.ts:80 | Origin stripping bypasses provenance checks | False positive: provenance checked first |
| SOL-CP-API-CSRF | C7a | — | src/index.ts:3745 | Browser can issue foreign-origin mutations | False positive: Origin rejected; JWT required |
| SOL-CP-DIAGNOSTICS-IDOR | C7a | — | src/ops/shared-admin/diagnostics-logs.ts:146 | Grant targets another customer’s device | False positive: ownership SQL and trigger |
| SOL-CP-CATALOG-LOST-WRITE | C7a | — | src/ops/shared-admin/catalog.ts:147 | Concurrent publication overwrites revision | False positive: conditional update checked |
| SOL-CP-PRODUCT-DOUBLE-ASSIGN | C7a | — | src/product-account.ts:330 | Concurrent assignment duplicates entitlement | False positive: atomic batch and unique index |
| SOL-CP-ACTION-RAW-READ | C7a | — | src/index.ts:604 | Action listing exposes raw samples | False positive: aggregate sanitizer |
| SOL-CP-FP-COUNT | C6 | — | src/telemetry/failure-clusters.ts:237 | Concurrent joins lose counts | False positive: atomic increment |
| SOL-CP-FP-AI-CONSENT | C6 | — | src/telemetry/diagnostics.ts:316 | AI facts stored without consent | False positive: consent guard precedes inserts |
| SOL-CP-FP-UNBOUNDED | C6 | — | src/telemetry/diagnostics.ts:14 | Diagnostic allocation is unbounded | False positive: request, array and field limits |
| SOL-CP-FP-DIAGNOSTICS-IDOR | C6 | — | src/telemetry/diagnostics-read.ts:250 | Device filter exposes another customer | False positive: customer and device constraints |
| SOL-CP-FP-READ-WRITE | C6 | — | src/telemetry/routes.ts:484 | Read token permits writes | False positive: routes are GET-only |
| SOL-CP-FP-METRIC-FIELDS | C6 | — | src/ops/legacy-handlers/metrics.ts:21 | Unknown fields produce malformed SQL | False positive: rejected before query |
| SOL-CP-FP-CORRUPT-JSON | C6 | — | src/telemetry-window.ts:197 | Normal ingestion stores corrupt JSON | False positive: canonical serialization |
| SOL-CP-FP-CORE-STDERR | C6 | — | tooling/scripts/core-helper/CoreManager.swift:291 | Automatic reports expose core stderr | False positive: synthetic exit status only |
| SOL-CP-FP-AUDIT-RETRY | C7b | — | src/product-account.ts:175 | Audit failure retries committed mutation | False positive: audit errors caught |
| SOL-CP-FP-FX-OVERFLOW | C7b | — | src/ops/fx.ts:62 | FX conversion overflows integer money | False positive: requires pathological unsupported rate |
| SOL-CP-FP-HOME-CYCLE | C7b | — | src/ops/home-lines.ts:175 | Inclusive billing boundary double-counts | False positive: no runtime caller |
| SOL-CP-FP-SESSION-BACKFILL | C7b | — | src/ops/customers-sessions.ts:59 | Backfill resurrects expired sessions | False positive: no runtime caller |
| SOL-CP-FP-HY2-MARGIN | C7b | — | src/ops/ledger.ts:223 | HY2 alias produces misleading margin | False positive: missing cost yields pending/null |
| SOL-CP-FP-LAST-HY2-NODE | C5/C7b | — | src/catalog-yaml.ts:654 | Second HY2 block permits retiring last node | False positive: callee checks remaining proxies |
| SOL-CP-FP-MIGRATION-PREFIX | C8 | — | migrations/README.md:11 | Repeated prefixes skip migrations | False positive: deliberate filename ordering |
| SOL-CP-FP-REBUILD-CASCADE | C8 | — | migrations/0017_expand_routing_research_payload.sql:1 | Rebuild cascades away live data | False positive: no child tables; fields copied |
| SOL-CP-FP-ORPHAN-DROP | C8 | — | migrations/0070_drop_orphan_diagnostics_and_destination_tables.sql:1 | Dropped tables contain current data | False positive: obsolete tables have no readers |
| SOL-CP-FP-PRODUCT-FK | C8 | — | migrations/0023_ops_management.sql:30 | User deletion conflicts with account constraint | False positive: runtime disables rather than deletes |
| SOL-CP-FP-PROD-WIPE | C8 | — | tooling/scripts/wipe-d1-in-order.mjs:16 | Production wipe bypasses guard | False positive: normal path refused; bypass requires admin |
| SOL-CP-ADMIN-DETAIL-RACE | C9 | — | admin/src/pages/users/CustomerDrawer.tsx:160 | Late response replaces another customer’s details | False positive: account binding fence |
| SOL-CP-ADMIN-DOUBLE-MUTATION | C9 | — | admin/src/pages/users/ask.tsx:29 | Double confirmation repeats mutations | False positive: exclusive gate and server guards |
| SOL-CP-ADMIN-DEV-FALLBACK | C9 | — | admin/src/api.ts:527 | Fixture pretends production mutation succeeded | False positive: development-only fallback |
| SOL-CP-ADMIN-BILLING-URL | C9 | — | admin/src/pages/monitor/NodeDrawer.tsx:248 | Billing link executes JavaScript | False positive: server requires HTTPS |
| SOL-CP-ADMIN-STALE-HEALTH | C9 | — | admin/src/lib/source-truth.ts:60 | Stale collector appears healthy | False positive: source age checked |
| SOL-CP-ADMIN-URL-PII | C9 | — | admin/src/pages/UsersPage.tsx:48 | Privacy search leaves email in URL | False positive: privacy mode clears search |
| SOL-CP-PREVIEW-PROD-DATA | C9 | — | preview/config.mjs:128 | Preview reuses production data | False positive: requires operator misconfiguration |
| SOL-CP-PUBLIC-STALE-FEED | C9 | — | public/releases/manifest.json:4 | Release feed lags source version | False positive: intentional last-published baseline |

| PR | Change | Status | Auto-merge | Labels |
|---|---|---|---|---|
| [#821](https://github.com/raydocs/tono/pull/821) | Stream installer ranges | Merged | Merge commit | — |
| [#832](https://github.com/raydocs/tono/pull/832) | Drain HY2 customers | Merged | Merge commit | `needs-hardware` |
| [#839](https://github.com/raydocs/tono/pull/839) | Freeze reconciliation | Merged | Merge commit | — |
| [#865](https://github.com/raydocs/tono/pull/865) | Guard reversal stamp | Merged | Merge commit | — |
| [#883](https://github.com/raydocs/tono/pull/883) | Fence month-close snapshot | Merged | Merge commit | — |
| [#890](https://github.com/raydocs/tono/pull/890) | Handle prototype-key names | Merged | Merge commit | — |
| [#903](https://github.com/raydocs/tono/pull/903) | Preserve cluster timestamps | Merged | Merge commit | — |
| [#918](https://github.com/raydocs/tono/pull/918) | Commit bundles atomically | Merged | Merge commit | — |
| [#924](https://github.com/raydocs/tono/pull/924) | Preserve completed sessions | Merged | Merge commit | — |
| [#931](https://github.com/raydocs/tono/pull/931) | Omit automatic raw excerpts | Merged | Merge commit | — |
| [#938](https://github.com/raydocs/tono/pull/938) | Support Unicode cursors | Merged | Merge commit | — |
| [#947](https://github.com/raydocs/tono/pull/947) | Preserve renewed log grants | Merged | Merge commit | — |

**60 hypotheses: 12 fixed, six real-unfixed, four duplicates, 38 false positives.**

Assigned C5–C9 runtime files and all 83 SQL migrations were reviewed. C9 CSS/SVG styling was not audited. Product decisions and the three legacy UI fixes remain deferred. No deployment, publication, production-data mutation or hardware test was performed; #832 awaits the coordinated device test.

[Completed report](/workspace/w1-codex/out/W1-sol-cp/report.md), [findings.tsv](/workspace/w1-codex/out/W1-sol-cp/findings.tsv), and [prs.tsv](/workspace/w1-codex/out/W1-sol-cp/prs.tsv) are saved.