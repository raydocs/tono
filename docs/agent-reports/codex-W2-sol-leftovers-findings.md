# W2-sol-leftovers: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 20:05 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 818 | hunt/sol-misc-malformed-match | none | yes | fix(macos): reject malformed MATCH imports without crashing |
| 823 | hunt/sol-misc-suite-reachability | none | yes | fix(tooling): avoid false missing-suite reports from SIGPIPE |
| 825 | hunt/sol-misc-quota-roundtrip | ui-review | no | fix(ops): preserve fractional quotas when saving node profiles |
| 834 | hunt/sol-misc-ws-handle | none | yes | fix(windows): let renderer WebSocket close reach native cleanup |
| 848 | hunt/sol-misc-fx-preview | ui-review | yes | fix(ops): preview the UTC posting-day exchange rate |
| 869 | hunt/sol-misc-destination-node | ui-review | no | fix(ops): preserve exit attribution in destination totals |
| 880 | hunt/sol-misc-page-freshness | ui-review | no | fix(ops): keep stale page reads visible after health refresh |
| 892 | hunt/sol-misc-install-arguments | none | yes | fix(tooling): refuse missing lifecycle test option values |
| 915 | hunt/sol-misc-ops-contract-findings | none | no | docs(findings): record remaining ops data contract defects |
| 957 | hunt/sol-misc-slo-utc-day | ui-review | no | fix(ops): retain UTC identity of daily SLO buckets |
| 965 | hunt/sol-misc-publisher-freshness | ui-review | no | fix(ops): apply publication metadata and refresh open history |
| 968 | hunt/sol-misc-device-read-error | ui-review | no | fix(ops): preserve failed device standing reads |
| 969 | hunt/sol-misc-command-identity | ui-review | no | fix(ops): give private command rows distinct identities |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| M14-MATCH-FLAG-CRASH | M14 | P3 | apps/macos/Tono/Models/RuleEntry.swift:102 | Malformed MATCH,no-resolve import removes its policy slot then indexes past the array | real-fixed #818; merged; ci-gate passed |
| T4-REACHABILITY-SIGPIPE | T4 | P3 | tooling/scripts/test-suite-reachability.sh:68 | grep -q closes the pipe after a match; pipefail rejects a correctly wired suite | real-fixed #823; merged; ci-gate passed |
| WIN-WS-ID-IPC-U128 | A13 | P2 | apps/windows/crates/tono-plugin-core/src/commands.rs:258 | Numeric u128 WebSocket handle cannot deserialize through Tauri; normal close leaves readers alive | real-fixed #834; merged; native regression and ci-gate passed |
| O1-QUOTA-ROUNDTRIP | O1 | P2 | services/ops-console/src/lib/node-detail.ts:303 | Editing a node rounds fractional GB quota and resubmits altered bytes | real-fixed #825 (ui-review; no auto-merge) |
| O1-FX-PREVIEW-DATE | O1 | P2 | services/ops-console/src/pages/settings/LedgerDrawer.tsx:98 | Foreign-currency cost preview uses paid date but Worker posts at current UTC-day rate | real-fixed #848; merged; exact-head ci-gate passed |
| M14-empty-region-name | M14 | P3 | apps/macos/Tono/Views/NodeCardView.swift:31 | Empty catalog name indexes an empty split result | duplicate #804 |
| M14-EXPORT-IO | M14 | — | apps/macos/Tono/Views/LogsView.swift:294 | Synchronous export to a stalled network share may block the UI | false-positive unverified native/network-share trigger; not presented as proven |
| M14-FP-UPDATE-TARGETS | M14 | — | apps/macos/Tono/Models/UpdateContractV1.swift:53 | Missing manifest targets might cause an index trap | false-positive count==2 short-circuits before indexing |
| M14-FP-IPV6-INDEX | M14 | — | apps/macos/Tono/Support/SubscriptionURLPolicy.swift:102 | IPv6 classification might index short buffers | false-positive explicit 16-byte guard |
| M14-FP-WELCOME-STEP | M14 | — | apps/macos/Tono/Views/WelcomeIntroView.swift:190 | Welcome step might escape its array | false-positive private zero-based state stops advancing at step three |
| M14-FP-CHART-CAPACITY | M14 | — | apps/macos/Tono/Views/TrafficChart.swift:19 | Negative chart capacity might trap | false-positive production constructors use fixed positive defaults |
| M14-FP-COUNTER-OVERFLOW | M14 | — | apps/macos/Tono/Views/DataUsageSummaryView.swift:11 | Chart or byte-counter arithmetic might overflow | false-positive no plausible normal-sized input trigger |
| M14-FP-SIGNIN-TIMER | M14 | — | apps/macos/Tono/Views/LoginView.swift:498 | Sign-in recurring timers might remain alive after navigation | false-positive explicit cancellation on disappearance |
| M14-FP-DASHBOARD-TASK | M14 | — | apps/macos/Tono/Views/DashboardView.swift:367 | Dashboard sampling might continue after navigation | false-positive SwiftUI task cancellation is checked |
| M14-FP-SUPPORT-IO | M14 | — | apps/macos/Tono/Models/SupportDiagnostics.swift:83 | Support process inspection might block the main thread | false-positive detached inspections and bounded launchctl waits |
| A13-FP-REST-TIMEOUT | A13 | — | apps/windows/crates/tono-plugin-core/src/mihomo.rs:253 | REST response consumption might wait forever | false-positive request timeout includes response body |
| A13-FP-WS-MACHINE-HANG | A13 | — | apps/windows/crates/tono-plugin-core/src/mihomo.rs:387 | Async WebSocket handshake might freeze the machine | false-positive frontend watchdog and tray task abort; no machine hang proved |
| A13-FP-WS-DEADLOCK | A13 | — | apps/windows/crates/tono-plugin-core/src/mihomo.rs:422 | Disconnect might hold the manager lock across await | false-positive removed-writer guard drops before await |
| A13-FP-ENUM-PARSE | A13 | — | apps/windows/crates/tono-plugin-core/src/models.rs:16 | Unknown proxy/network enum might reject the full response | false-positive unknown strings are preserved |
| A13-FP-LOGGER-GROWTH | A13 | — | apps/windows/crates/tono-logger/src/lib.rs:104 | Logger might grow without bound or await under its lock | false-positive bounded 100-entry queue and no awaited critical section |
| A13-FP-CONTROLLER-RACE | A13 | — | apps/windows/crates/tono-plugin-core/src/mihomo.rs:312 | Separate controller updates might permanently corrupt credentials | false-positive transient snapshot only; no lasting realistic failure proved |
| A13-FP-GROUP-UNPIN | A13 | — | apps/windows/crates/tono-plugin-core/src/commands.rs:74 | Failed group delay might unpin the selected product node | false-positive no product caller; endpoint deliberately clears pin |
| WIN-WS-ONCONNECTED-WATCHDOG | A13 | P3 | apps/windows/app/src/hooks/use-mihomo-ws-subscription.ts:145 | Late initialization watchdog drops subscription cleanup | duplicate #768 |
| O1-PAGE-FRESHNESS | O1 | P2 | services/ops-console/src/lib/use-resource.ts:73 | New shared health fetch masks old page data; Clients own reads do not poll | real-fixed #880; merged; exact-head ci-gate passed |
| O1-ADOPTION-DRILLDOWN | O1 | P2 | services/ops-console/src/lib/customers.ts:223 | Platform adoption drilldown uses all-platform oldest version and a different time window | real-unfixed needs shared server cohort contract; outside tiny console-only fixes; recorded #915 |
| O1-ADOPTION-TOTAL | O1 | P2 | services/ops-console/src/pages/Clients.tsx:159 | Adding overlapping matrix user counts reports duplicate people | real-unfixed API lacks identity union; server aggregation needed; recorded #915 |
| O1-DESTINATION-NODE | O1 | P2 | services/ops-console/src/pages/customer/Destinations.tsx:30 | Destination fold combines exits while keeping only the first node | real-fixed #869; merged; exact-head ci-gate passed |
| O1-ANCHOR-CLAMPED | O1 | P2 | services/ops-console/src/pages/node/ProfileDrawer.tsx:80 | Month-end quota anchor reconstructed from February changes31 to28 on save | real-unfixed configured anchor absent from DTO; contract/payload preservation needed; recorded #915 |
| O1-ANCHOR-UTC | O1 | P2 | services/ops-console/src/lib/node-detail.ts:325 | Local date shifts the recovered UTC billing anchor | duplicate #805 |
| O1-FP-EARLY-RENEWAL | O1 | — | services/ops-console/src/lib/customers.ts:32 | Early renewal might truncate paid time | false-positive max(now,currentExpiry)+30days preserves existing time |
| O1-FP-RENEWAL-RETRY | O1 | — | services/ops-console/src/pages/customer/ExpiryDrawer.tsx:206 | Ledger retry might renew twice | false-positive fixed renewal target is reused |
| O1-FP-HOME-QUOTA | O1 | — | services/ops-console/src/pages/settings/HomeLineDrawer.tsx:69 | Home-line quota display rounding might rewrite bytes | false-positive original raw bytes retained until quota field changes |
| O1-FP-DOCUMENT-CAS | O1 | — | services/ops-console/src/pages/settings/use-document.ts:135 | Concurrent publication might overwrite revisions | false-positive expected-revision CAS preserves the rejected draft |
| O1-FP-COUNTER-RESET | O1 | — | services/ops-console/src/lib/node-legacy.ts:189 | Counter reset might produce a negative network rate | false-positive reset gives missing measurement |
| O1-FP-INVITE-TOTAL | O1 | — | services/ops-console/src/lib/funnel.ts:34 | Invite and customer totals might overlap registered users | false-positive invite rows exclude registered user IDs |
| O1-FP-CONNECTED-HEALTH | O1 | — | services/ops-console/src/lib/customers.ts:119 | Old connected status might count as healthy | false-positive predicates use Worker verdict |
| O1-FP-UNMETERED-ZERO | O1 | — | services/control-plane/src/ops/handlers/nodes-data.ts:187 | Missing quota measurement might look like measured zero | false-positive Worker used:null remains missing |
| O1-FP-LIST-CAP | O1 | — | services/ops-console/src/lib/api.ts:126 | List cap might be accidental pagination loss | false-positive explicit 2000-item product bound |
| O1-FP-LOCAL-DATES | O1 | — | services/ops-console/src/lib/settings.ts:158 | Every local date conversion might corrupt time zones | false-positive invoice/expiry inputs intentionally use local calendar dates |
| T4-FP-HELPER-MANIFEST | T4 | — | tooling/scripts/build-core-helper.sh:56 | Hash pipeline might silently omit a missing helper source | false-positive swiftc also requires each manifest source and prevents output publication |
| T4-FP-SLOT-REAP | T4 | — | tooling/scripts/with-slot.sh:117 | Stale lock reaping might cause customer network loss or a machine hang | false-positive claimed customer impact; no product/runtime path, narrow operator race remains unverified |
| T4-REGISTRATION-GLOB | T4 | P3 | tooling/scripts/test-suite-reachability.sh:68 | Guard does not recognize wildcard invocations and some suites lack callers | real-unfixed pre-existing scanner/registration gaps; documented in #823, no CI gate lowered |
| T4-INSTALL-MISSING-ARG | T4 | P3 | tooling/scripts/test-helper-install-lifecycle.sh:47 | Trailing option without value repeats failed shift forever | real-fixed #892; merged; exact-head ci-gate passed |
| T4-AGGREGATE-INSTALL-INPUT | T4 | P3 | tooling/scripts/test-macos-all.sh:79 | Aggregate supplies app but omits required emitted install script | real-unfixed separate harness input contract; native path not executed; engineering limitation recorded #915 |
| T4-AGGREGATE-HIDDEN-SKIP | T4 | P3 | tooling/scripts/test-macos-all.sh:27 | Aggregate hides authorization-suite skip text and counts zero exit as pass | real-unfixed aggregate status-reporting contract; intentional native identity skip retained; engineering limitation recorded #915 |
| T4-FP-SLOT-STATUS | T4 | — | tooling/scripts/with-slot.sh:76 | Slot lock might mask command failure | false-positive both locking implementations preserve child exit status |
| T4-FP-SLOT-TRAVERSAL | T4 | — | tooling/scripts/with-slot.sh:36 | Slot names might escape lock directory | false-positive validation rejects path traversal |
| T4-FP-RECORDS-OVERRIDE | T4 | — | tooling/scripts/records.mjs:86 | Findings fragments might leave stale duplicate ledger values | false-positive fragments replace entries by ID; regression passed |
| T4-FP-JWT-EXTRACT | T4 | — | tooling/scripts/test-jwt-expiry.sh:35 | Missing extraction marker might pass an empty JWT test | false-positive explicit refusal before compilation |
| T4-FP-ISOLATED-TUN | T4 | — | tooling/scripts/tests/IsolatedDataPlaneRuntime.swift:74 | Isolated test might mutate system tunnel or DNS | false-positive TUN disabled and DNS listener is local |
| T4-FP-RELOAD-PROOF | T4 | — | tooling/scripts/test-reload-preserves-connections.sh:180 | Reload test might pass without demonstrating a reload | false-positive reload succeeds before stream signal and fresh roundtrip |
| T4-FP-INSTALL-BACKUP | T4 | — | tooling/scripts/test-helper-install-lifecycle.sh:169 | Lifecycle test might overwrite originals or report success before restore | false-positive verified backups precede mutation; failures retain evidence and success follows restore |
| O1-SLO-DAY-UTC | O1 | P2 | services/ops-console/src/pages/settings/LedgerSlo.tsx:41 | UTC daily SLO bucket is labeled as the previous local date west of UTC | real-fixed #957; ui-review; no auto-merge; new integration CI pending (old baseline failure repaired #931) |
| O1-PUBLISH-METADATA | O1 | P2 | services/ops-console/src/pages/settings/use-document.ts:135 | New publication retains old timestamp and policy signature marker | real-fixed #965; ui-review; no auto-merge;10local browser flows passed; new integration CI pending |
| O1-CATALOG-HISTORY | O1 | P2 | services/ops-console/src/pages/settings/Catalog.tsx:176 | Open catalog history retains old current revision after successful publish | real-fixed #965; ui-review; no auto-merge;10local browser flows passed; new integration CI pending |
| O1-DEVICE-READ-ERROR | O1 | P2 | services/ops-console/src/pages/customer/Devices.tsx:69 | Failed standing read claims no past action and assumes logs closed | real-fixed #968; ui-review; no auto-merge; local regression passed; new integration CI pending |
| O1-ACTIVITY-HOUR-COLLISION | O1 | P2 | services/ops-console/src/components/ops/HeatStrip.tsx:34 | Device rows or DST repeated local hours overwrite traffic and connection presence | real-unfixed interval/device-minute and repeated-hour semantics require decision; recorded #915 |
| O1-COMMAND-IDENTITY-COLLISION | O1 | P2 | services/ops-console/src/app/CommandPalette.tsx:95 | Masked email is cmdk identity; Enter can open the wrong customer | real-fixed #969; ui-review; no auto-merge; strict-index test correction4c31162d local-only after two push failures; operator patch required |
| O1-FP-CLOSURE-SELECTION | O1 | — | services/ops-console/src/pages/today/CloseDialog.tsx:37 | Verified closure might remain selected after proof turns alarming | false-positive committed verdict binds incident identity; changed kinds retire old ID |
| O1-FP-RETIRE-PREVIEW | O1 | — | services/control-plane/src/ops/reads/fleet.ts:216 | Old retirement preview might permit unsafe mutation | false-positive rebuilt preview and revision/safety CAS guard actual write |
| O1-FP-PENDING-ENTITLEMENT | O1 | — | services/control-plane/src/legacy-handlers/users.ts:327 | Onboarding might lose the pending plan or expiry | false-positive pending profile preserved through registration race |
| O1-FP-POOLED-ACCOUNT | O1 | — | services/control-plane/src/product-account.ts:305 | Pooled account selection might duplicate an existing identity | false-positive guarded pooled-to-assigned transaction claims existing row |
| O1-FP-TIMESERIES | O1 | — | services/ops-console/src/components/ops/TimeSeries.tsx:55 | Index spacing might distort uneven timestamps | false-positive node-legacy supplies uniform buckets including gaps |
| O1-FP-COUNTTEXT | O1 | — | services/ops-console/src/components/ops/CountText.tsx:28 | Changing count array length might leave wrong numbers | false-positive production callers use fixed length; intermediate animation deliberate |
| O1-FP-FIXTURE-UNITS | O1 | — | services/ops-console/src/lib/ops-fixtures.ts:60 | Fixture clock shift might mix seconds and milliseconds | false-positive explicit millisecond keys and aligned hour/day buckets |
| O1-FP-COVERAGE-ZERO | O1 | — | services/ops-console/src/lib/health.ts:57 | Empty population might be falsely described as covered | false-positive explicit empty-population behavior |
| O1-FP-QUOTA-FORECAST | O1 | — | services/ops-console/src/components/ops/QuotaGauge.tsx:109 | Forecast might extrapolate from stale data against current time | false-positive fallback uses measurement time; callers provide server forecast |
| O1-FP-RECEIPT-REVISION | O1 | — | services/ops-console/src/lib/receipts.ts:16 | Non-policy receipt might get a wrong catalog revision label | false-positive those revision receipts are catalog publish/retire/relist |
| O1-FP-LEDGER-WRITE-READINESS | O1 | — | services/ops-console/src/pages/settings/Ledger.tsx:67 | Lock or reversal might remain enabled after failed post-write refresh | false-positive summary nonce/target revision retire old readiness and confirm is guarded |
| O1-FP-AUDIT-CURSOR | O1 | — | services/ops-console/src/pages/settings/Audit.tsx:55 | Same-second audit rows might disappear across pages | false-positive timestamp and ID travel together and Worker applies tuple cursor |
| O1-FP-AUDIT-TIMEZONE | O1 | — | services/ops-console/src/pages/settings/AuditFilters.tsx:19 | Audit datetime filter might use the wrong timezone | false-positive input/parser both local and label explicitly says local |
| O1-FP-ALERT-DURATION | O1 | — | services/ops-console/src/lib/settings.ts:55 | Alert delay might round ninety seconds to minutes | false-positive larger units chosen only when exactly divisible |
| O1-FP-DELIVERY-CAP | O1 | — | services/ops-console/src/lib/settings.ts:72 | Eight-row delivery count might purport to be full history | false-positive explicit recent-deliveries sanity-check scope |
| O1-FP-PROVIDER-MASK | O1 | — | services/ops-console/src/pages/settings/Providers.tsx:210 | Provider save might mask an already masked address again | false-positive unchanged login email omitted from update |
| O1-FP-RECON-MISSING | O1 | — | services/ops-console/src/pages/settings/LedgerRecon.tsx:98 | Missing reconciliation amount might appear as zero | false-positive null stays missing; expected amount used only if supplied |
| O1-FP-SLO-ZERO | O1 | — | services/ops-console/src/pages/settings/LedgerSlo.tsx:92 | Zero attempts might cause division by zero | false-positive explicit positive-attempts guard |
| O1-FP-SLO-OUTAGE | O1 | — | services/control-plane/src/ops/handlers/slo.ts:82 | SLO summary might count the same outage repeatedly | false-positive Worker deduplicates node/day before summing |
| O1-FP-SLO-MONTH | O1 | — | services/ops-console/src/pages/settings/LedgerSlo.tsx:24 | SLO table might falsely represent selected ledger month | false-positive visible 7/30-day controls and rolling API define intended interval |
| O1-FP-REHEARSAL-FRESH | O1 | — | services/ops-console/src/pages/settings/Policy.tsx:81 | Edited policy might retain a fresh signing rehearsal | false-positive forText comparison marks edited draft stale |
| O1-FP-HOMEEXIT-PORT | O1 | — | services/ops-console/src/pages/settings/HomeExitDrawer.tsx:96 | Invalid home-exit port might reach the write | false-positive integer and 1..65535 guards precede submission and Worker also validates |
