# codex-ledger (Codex account 2 slots; mirrored from the orchestrator LEDGER.md on the box)

## Codex account-2 slot results (Sol, executor)

### W1-sol-cp (finished 19:51 MT; 60 hypotheses, 38 FP, PRs: #821 #832 #839 #865 #883 #890 #903 #918 #924 #931 #938 #947)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| SOL-CP-AUTH-GATES | C7a | Sol (Codex acct 2, W1-sol-cp) | P2 | duplicate #716 / H4-F3 | Shared-admin and legacy reads bypass role authorization [services/control-plane/src/index.ts:2928] |
| SOL-CP-CURSOR-LONG-EMAIL | C7a/C7b | Sol (Codex acct 2, W1-sol-cp) | P2 | duplicate of #770 merged cursor bound expansion | Cursor sort key rejects valid long customer email at page boundary [services/control-plane/src/ops/http.ts:23] |
| SOL-CP-HOME-PASTE-PASSWORD | C7a/C5 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-unfixed decision item: shared credential authority/rotation semantics; automatic replacement could overwrite a newer shared secret | Pasting same home tuple with different pasted password keeps old password unless flagged [services/control-plane/src/ops/shared-admin/home-exits.ts:178] |
| SOL-CP-LOG-RENEW-SWEEP | C7a | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #947 | Expired-window sweep can delete a renewed grant [services/control-plane/src/ops/shared-admin/diagnostics-logs.ts:96] |
| SOL-CP-ONBOARD-ROLE | C7a | Sol (Codex acct 2, W1-sol-cp) | P2 | real-unfixed decision item: onboarding inventory rights overlap #716 policy | Operator onboarding internally edits inventory owner-gated by #716 [services/control-plane/src/ops/legacy-handlers/users.ts:267] |
| SOL-C5-RELEASE-RANGE-BUFFER | C5 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #821 | Legacy ranged installer GET buffers and copies selected body [services/control-plane/src/releases/host.ts:118] |
| SOL-CP-HY2-RETIRE-DRAIN | C7b | Sol (Codex acct 2, W1-sol-cp) | P1 | real-fixed #832 | Retirement misses recent HY2 clients and revokes exit admission before drain [services/control-plane/src/ops/retire-dependencies.ts:64] |
| SOL-CP-MONTH-RECON-SNAPSHOT | C7b | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #839 | Closed month omits frozen reconciliation snapshot [services/control-plane/src/ops/ledger.ts:80] |
| SOL-CP-DIAGNOSTICS-PARTIAL | C6 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #918 | Invalid later array entry returns 400 after earlier diagnostic rows commit [services/control-plane/src/telemetry/diagnostics.ts:156] |
| SOL-CP-METRICS-NAME | C6 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #890 | Valid node constructor collides with inherited object key and metrics throws [services/control-plane/src/ops-timeseries.ts:479] |
| SOL-CP-CLUSTER-LAST-SEEN | C6 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #903 | Delayed events rewind last_seen and split active outage [services/control-plane/src/telemetry/failure-clusters.ts:237] |
| SOL-CP-SESSION-REWIND | C6 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #924 | Retried beginning payload clears completed-session fields and bytes [services/control-plane/src/telemetry/diagnostics.ts:162] |
| SOL-CP-EXCERPT-PRIVACY | C6 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #931 | Privacy-safe excerpt intake preserves complete IPv6 addresses and tokens [services/control-plane/src/telemetry/diagnostics.ts:151] |
| SOL-CP-CLUSTER-OPEN-RACE | C6 | Sol (Codex acct 2, W1-sol-cp) | P2 | duplicate fixed #766 | Concurrent cluster opens may collide [services/control-plane/src/telemetry/failure-clusters.ts:217] |
| SOL-CP-LEDGER-CLOSE-RACE | C7b | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #883 | Close can freeze a summary missing a ledger write accepted during reads [services/control-plane/src/ops/handlers/ledger.ts:323] |
| SOL-CP-PROFILE-PORT | C7b | Sol (Codex acct 2, W1-sol-cp) | P3 | real-unfixed decision item: persisted profile schema has no port field | Documented profile port is validated then discarded [services/control-plane/src/ops/handlers/nodes-profile.ts:107] |
| SOL-CP-REVERSE-CLOSE-RACE | C7b | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #865 | Close racing reversal leaves dangling reversed_by despite rejected INSERT [services/control-plane/src/ops/handlers/ledger.ts:273] |
| SOL-CP-ADMIN-REFRESH-DEFAULT | C9 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-unfixed deferred under requested UI restriction; runtime proved | Absent localStorage key disables default auto-refresh [services/control-plane/admin/src/hooks.tsx:213] |
| SOL-CP-ADMIN-HY2-IDENTITY | C9 | Sol (Codex acct 2, W1-sol-cp) | P2 | real-unfixed deferred under requested UI restriction; runtime proved | Legacy console creates second machine identity for hy2 block [services/control-plane/admin/src/lib/catalog.ts:31] |
| SOL-CP-ADMIN-USERS-PAGE | C9 | Sol (Codex acct 2, W1-sol-cp) | P3 | real-unfixed deferred under requested UI restriction; scaling-only | Legacy user client ignores pagination beyond 2000 customers [services/control-plane/admin/src/api.ts:685] |
| SOL-CP-ADMIN-DRAFT-RACE | C9 | Sol (Codex acct 2, W1-sol-cp) | — | duplicate #713 removes legacy editor | Dirty editor might bypass discard confirmation [services/control-plane/admin/src/pages/ControlPage.tsx:241] |
| SOL-CP-CURSOR-UNICODE-LIMIT | C7a | Sol (Codex acct 2, W1-sol-cp) | P2 | real-fixed #938 | Accepted long Unicode node names exceed encoded cursor bounds or token parser cap [services/control-plane/src/ops/http.ts:22] |

### W2-sol-leftovers (finished 20:05 MT; 80 hypotheses, 57 FP, PRs: #818 #823 #825 #834 #848 #869 #880 #892 #915 #957 #965 #968 #969)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| M14-MATCH-FLAG-CRASH | M14 | Sol (Codex acct 2, W2-sol-leftovers) | P3 | real-fixed #818; merged; ci-gate passed | Malformed MATCH,no-resolve import removes its policy slot then indexes past the array [apps/macos/Tono/Models/RuleEntry.swift:102] |
| T4-REACHABILITY-SIGPIPE | T4 | Sol (Codex acct 2, W2-sol-leftovers) | P3 | real-fixed #823; merged; ci-gate passed | grep -q closes the pipe after a match; pipefail rejects a correctly wired suite [tooling/scripts/test-suite-reachability.sh:68] |
| WIN-WS-ID-IPC-U128 | A13 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-fixed #834; merged; native regression and ci-gate passed | Numeric u128 WebSocket handle cannot deserialize through Tauri; normal close leaves readers alive [apps/windows/crates/tono-plugin-core/src/commands.rs:258] |
| O1-QUOTA-ROUNDTRIP | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-fixed #825 (ui-review; no auto-merge) | Editing a node rounds fractional GB quota and resubmits altered bytes [services/ops-console/src/lib/node-detail.ts:303] |
| O1-FX-PREVIEW-DATE | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-fixed #848; merged; exact-head ci-gate passed | Foreign-currency cost preview uses paid date but Worker posts at current UTC-day rate [services/ops-console/src/pages/settings/LedgerDrawer.tsx:98] |
| M14-empty-region-name | M14 | Sol (Codex acct 2, W2-sol-leftovers) | P3 | duplicate #804 | Empty catalog name indexes an empty split result [apps/macos/Tono/Views/NodeCardView.swift:31] |
| WIN-WS-ONCONNECTED-WATCHDOG | A13 | Sol (Codex acct 2, W2-sol-leftovers) | P3 | duplicate #768 | Late initialization watchdog drops subscription cleanup [apps/windows/app/src/hooks/use-mihomo-ws-subscription.ts:145] |
| O1-PAGE-FRESHNESS | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-fixed #880; merged; exact-head ci-gate passed | New shared health fetch masks old page data; Clients own reads do not poll [services/ops-console/src/lib/use-resource.ts:73] |
| O1-ADOPTION-DRILLDOWN | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-unfixed needs shared server cohort contract; outside tiny console-only fixes; recorded #915 | Platform adoption drilldown uses all-platform oldest version and a different time window [services/ops-console/src/lib/customers.ts:223] |
| O1-ADOPTION-TOTAL | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-unfixed API lacks identity union; server aggregation needed; recorded #915 | Adding overlapping matrix user counts reports duplicate people [services/ops-console/src/pages/Clients.tsx:159] |
| O1-DESTINATION-NODE | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-fixed #869; merged; exact-head ci-gate passed | Destination fold combines exits while keeping only the first node [services/ops-console/src/pages/customer/Destinations.tsx:30] |
| O1-ANCHOR-CLAMPED | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-unfixed configured anchor absent from DTO; contract/payload preservation needed; recorded #915 | Month-end quota anchor reconstructed from February changes31 to28 on save [services/ops-console/src/pages/node/ProfileDrawer.tsx:80] |
| O1-ANCHOR-UTC | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | duplicate #805 | Local date shifts the recovered UTC billing anchor [services/ops-console/src/lib/node-detail.ts:325] |
| T4-REGISTRATION-GLOB | T4 | Sol (Codex acct 2, W2-sol-leftovers) | P3 | real-unfixed pre-existing scanner/registration gaps; documented in #823, no CI gate lowered | Guard does not recognize wildcard invocations and some suites lack callers [tooling/scripts/test-suite-reachability.sh:68] |
| T4-INSTALL-MISSING-ARG | T4 | Sol (Codex acct 2, W2-sol-leftovers) | P3 | real-fixed #892; merged; exact-head ci-gate passed | Trailing option without value repeats failed shift forever [tooling/scripts/test-helper-install-lifecycle.sh:47] |
| T4-AGGREGATE-INSTALL-INPUT | T4 | Sol (Codex acct 2, W2-sol-leftovers) | P3 | real-unfixed separate harness input contract; native path not executed; engineering limitation recorded #915 | Aggregate supplies app but omits required emitted install script [tooling/scripts/test-macos-all.sh:79] |
| T4-AGGREGATE-HIDDEN-SKIP | T4 | Sol (Codex acct 2, W2-sol-leftovers) | P3 | real-unfixed aggregate status-reporting contract; intentional native identity skip retained; engineering limitation recorded #915 | Aggregate hides authorization-suite skip text and counts zero exit as pass [tooling/scripts/test-macos-all.sh:27] |
| O1-SLO-DAY-UTC | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-fixed #957; ui-review; no auto-merge; new integration CI pending (old baseline failure repaired #931) | UTC daily SLO bucket is labeled as the previous local date west of UTC [services/ops-console/src/pages/settings/LedgerSlo.tsx:41] |
| O1-PUBLISH-METADATA | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-fixed #965; ui-review; no auto-merge;10local browser flows passed; new integration CI pending | New publication retains old timestamp and policy signature marker [services/ops-console/src/pages/settings/use-document.ts:135] |
| O1-CATALOG-HISTORY | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-fixed #965; ui-review; no auto-merge;10local browser flows passed; new integration CI pending | Open catalog history retains old current revision after successful publish [services/ops-console/src/pages/settings/Catalog.tsx:176] |
| O1-DEVICE-READ-ERROR | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-fixed #968; ui-review; no auto-merge; local regression passed; new integration CI pending | Failed standing read claims no past action and assumes logs closed [services/ops-console/src/pages/customer/Devices.tsx:69] |
| O1-ACTIVITY-HOUR-COLLISION | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-unfixed interval/device-minute and repeated-hour semantics require decision; recorded #915 | Device rows or DST repeated local hours overwrite traffic and connection presence [services/ops-console/src/components/ops/HeatStrip.tsx:34] |
| O1-COMMAND-IDENTITY-COLLISION | O1 | Sol (Codex acct 2, W2-sol-leftovers) | P2 | real-fixed #969; ui-review; no auto-merge; strict-index test correction4c31162d local-only after two push failures; operator patch required | Masked email is cmdk identity; Enter can open the wrong customer [services/ops-console/src/app/CommandPalette.tsx:95] |

### W1-sol-win-app (finished 20:33 MT; 107 hypotheses, 87 FP, PRs: #820 #828 #898 #916 #932 #951 #980 #984)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| W1-CONNECTION-RACES | A1 | Sol (Codex acct 2, W1-sol-win-app) | P3 | duplicate #798 | Duplicate fail_connect release and stale recovery selection [apps/windows/app/src-tauri/src/tono/connection.rs:275] |
| WIN-STATUS-LISTENER-LEAK | A10 | Sol (Codex acct 2, W1-sol-win-app) | P3 | real-fixed #820 | Later page mounts leak backend status listeners and duplicate callbacks [apps/windows/app/src/services/tono.ts:861] |
| WIN-DNS-CALLBACK-LIFETIME | A8 | Sol (Codex acct 2, W1-sol-win-app) | P2 | real-fixed #828 | DNS deadline wake may free completion before callback notification [apps/windows/app/src-tauri/src/tono/windows_dns.rs:149] |
| WIN-DIRECT-RESTORE-WRITER-DELAY | A1 | Sol (Codex acct 2, W1-sol-win-app) | P1 | real-fixed #898 | A stalled DIRECT controller reload holds lifecycle reader for 120 seconds and blocks Restore [apps/windows/app/src-tauri/src/tono/connection/direct.rs:1211] |
| WIN-LOG-UPLOAD-IDENTIFIERS | A9 | Sol (Codex acct 2, W1-sol-win-app) | P2 | real-fixed #916 | Scoped raw-log uploads include sign-in email and revoked-device identifier [apps/windows/app/src-tauri/src/tono/log_upload.rs:223] |
| W1-NATIVE-WS-CLOSE | A10 | Sol (Codex acct 2, W1-sol-win-app) | P2 | duplicate #834 | Renderer close cannot pass full native WebSocket identifier [apps/windows/crates/tono-plugin-core/src/commands.rs:258] |
| W1-WS-HANDSHAKE | A10 | Sol (Codex acct 2, W1-sol-win-app) | P2 | duplicate #807/#768 | Hung handshake or late init wedges socket subscription [apps/windows/app/src/hooks/use-mihomo-ws-subscription.ts:1] |
| W1-DOH-RESPONSE-CAP | A5 | Sol (Codex acct 2, W1-sol-win-app) | P2 | duplicate previous slot deferred lead | Trusted DoH resolver body is read without size cap [apps/windows/app/src-tauri/src/tono/transport.rs:689] |
| W1-SIGNED-APP-RECONNECT | A8 | Sol (Codex acct 2, W1-sol-win-app) | P1 | duplicate #757 | Signed app path change needs protected reconnect [apps/windows/app/src-tauri/src/tono/connection/monitor.rs:431] |
| WIN-STALE-SIGNED-APP-PATHS | A1 | Sol (Codex acct 2, W1-sol-win-app) | P2 | duplicate #900 WIN-WECHAT-PATH-STALE | Fresh full-tunnel attempt retains old DIRECT path snapshot and can reconnect every two minutes after app update [apps/windows/app/src-tauri/src/tono/connection.rs:366] |
| WIN-ACCOUNT-CACHE-OWNERSHIP | A10 | Sol (Codex acct 2, W1-sol-win-app) | P1 | real-fixed #932 | Replacement sign-in keeps prior account device metadata when new fetch fails [apps/windows/app/src/tono-ui/TonoAccountCard.tsx:52] |
| WIN-VAULT-WRITE-RETRY | A5 | Sol (Codex acct 2, W1-sol-win-app) | P1 | duplicate #843; late rotation still needs a flush trigger before Quit (owner limitation) | Transient vault write loses durable sign-in or rotated token [apps/windows/app/src-tauri/src/tono/credentials.rs:743] |
| W1-RESTORE-SCM-HANG | A9/A1 | Sol (Codex acct 2, W1-sol-win-app) | P1 | duplicate #912 owned by another hunter | Native SCM probe can delay release admission [apps/windows/app/src-tauri/src/tono/connection.rs:3189] |
| W1-RESTORE-CORE-OWNER | A9/A1 | Sol (Codex acct 2, W1-sol-win-app) | P1 | duplicate merged #873 | Missing owner record skips core teardown [apps/windows/service/src/core/server/handlers.rs:405] |
| W1-RESTORE-DNS-COMPENSATION | A9/A1 | Sol (Codex acct 2, W1-sol-win-app) | P1 | duplicate #846/#866; blind disarm would require AI/strict policy decision | Core stop after DNS restoration failure leaves stale snapshot semantics [apps/windows/service/src/core/server/handlers.rs:405] |
| WIN-ACTIVITY-PROCESS-PROTOTYPE | A10 | Sol (Codex acct 2, W1-sol-win-app) | P2 | real-fixed #951; Windows game socket ownership inferred from primary developer executable/multiplayer evidence | Constructor.exe process becomes inherited Object constructor and crashes Activity aggregation [apps/windows/app/src/pages/tono/activity-model.ts:133] |
| WIN-QUIT-ROTATED-TOKEN-DURABILITY | A5/A9 | Sol (Codex acct 2, W1-sol-win-app) | P1 | real-fixed #980 | Committed Quit skips the retry flush for a transiently failed rotated-token vault write [apps/windows/app/src-tauri/src/tono/commands/quit.rs:358] |
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | A1 | Sol (Codex acct 2, W1-sol-win-app) | P1 | real-unfixed follow-up to #898; cancellation-only opens AI sooner and existing best-effort AI fallback cannot guarantee top rule | Automatic health release never cancels the stalled DIRECT reader and normal internet remains Blocked about two minutes [apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1384] |
| W1-AUTO-HEALTH-AI-HOLD | A1 | Sol (Codex acct 2, W1-sol-win-app) | — | duplicate SFO-1/#738 and ZC-F1/#706; needs existing guaranteed-fallback decision/implementation | Automatic health release omits guaranteed secondary AI blocking [apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1391] |
| WIN-SINGLETON-INHERITED-PROXY | A9 | Sol (Codex acct 2, W1-sol-win-app) | P3 | real-fixed #984 | Inherited HTTP proxy intercepts authenticated localhost notification and second launch fails after twenty seconds [apps/windows/app/src-tauri/src/utils/server.rs:100] |

### W1-sol-win-trust (finished 21:05 MT; 89 hypotheses, 73 FP, PRs: #PR#843 #PR#873 #PR#912 #PR#933 #PR#955 #PR#983 #PR#990)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| WIN-VAULT-WRITE-RETRY | A12 | Sol (Codex acct 2, W1-sol-win-trust) | P1 | real-fixed #843 | Failed vault mutations discarded; flush never retried persistence [apps/windows/app/src-tauri/src/tono/credentials.rs:743] |
| WIN-OWNER-RELEASE-NONE | W6 | Sol (Codex acct 2, W1-sol-win-trust) | P1 | real-fixed #873 | Missing/corrupt active-owner lets release skip live Core stop [apps/windows/service/src/core/server/handlers.rs:415] |
| AUTH-LOGOUT-REPLACEMENT | A12 | Sol (Codex acct 2, W1-sol-win-trust) | — | duplicate previously fixed identity race | Logout could erase replacement account [apps/windows/crates/tono-core/src/auth.rs:1334] |
| POLICY-AI-SUFFIX | A12 | Sol (Codex acct 2, W1-sol-win-trust) | — | duplicate #797 | Signed direct suffix could cover AI services [apps/windows/crates/tono-core/src/policy.rs:334] |
| RECOVERY-STALE-SELECTION | A12 | Sol (Codex acct 2, W1-sol-win-trust) | — | duplicate codex2 in-flight stale-preflight candidate | Late preflight could use deselected exit [apps/windows/app/src-tauri/src/tono/connection/heal.rs:99] |
| W6-APP-IDENTITY | W6 | Sol (Codex acct 2, W1-sol-win-trust) | — | duplicate #352 | Same-user non-App mutation access [apps/windows/service/src/core/server/mod.rs:800] |
| W6-START-FAILURE | W6 | Sol (Codex acct 2, W1-sol-win-trust) | — | duplicate #769 | Post-arm Core start failure keeps protection [apps/windows/service/src/core/server/handlers.rs:703] |
| W6-SERVICE-STOP | W6 | Sol (Codex acct 2, W1-sol-win-trust) | — | duplicate #792 | Ordinary service stop retains protection [apps/windows/service/src/core/server/mod.rs:457] |
| WIN-GOODBYE-CONNECT-RACE | W6 | Sol (Codex acct 2, W1-sol-win-trust) | P2 | real-fixed #955 | Accepted goodbye can stop a connection started in its 250ms grace [apps/windows/service/src/core/server/mod.rs:392] |
| WIN-RELEASE-SCM-PROBE-HANG | A7 | Sol (Codex acct 2, W1-sol-win-trust) | P1 | real-fixed #912 | Unbounded stopped-state query permanently holds Disconnect release worker [apps/windows/app/src-tauri/src/core/service/mod.rs:524] |
| A7-INSTALLER-INHERITED-PIPE | A7 | Sol (Codex acct 2, W1-sol-win-trust) | — | duplicate known installer hang fixed by status and bounded quarantine | Inherited output handles deadlock installer [apps/windows/app/src-tauri/src/core/service/install.rs:559] |
| A7-SCM-ERROR-PATH | A7 | Sol (Codex acct 2, W1-sol-win-trust) | P1 | duplicate same root cause WIN-RELEASE-SCM-PROBE-HANG; included in fix | Connect and Repair also perform unbounded SCM evidence/BFE reads [apps/windows/app/src-tauri/src/core/service/mod.rs:614] |
| AUTH-UNOWNED-CACHE-RESIDUAL | A12 | Sol (Codex acct 2, W1-sol-win-trust) | P2 | duplicate documented H3-F1/#316 residual; no ownership binding | Persistent cache-file sharing failure retains previous account catalog [apps/windows/app/src-tauri/src/tono/catalog_sync.rs:147] |
| WIN-SCM-VERIFIER-WORKERS | W6 | Sol (Codex acct 2, W1-sol-win-trust) | P2 | real-fixed #933 | Repeated monitor calls spawn unbounded detached SCM verifier threads during a sustained stall [apps/windows/service/src/client/mod.rs:165] |
| WIN-SELECTIVE-RELEASE-RETRY | A7 | Sol (Codex acct 2, W1-sol-win-trust) | P2 | real-fixed #983 | Automatic selective release retries all failures as plain release, dropping AI hold [apps/windows/app/src-tauri/src/core/service/mod.rs:1323] |
| AUTH-CLOCK-REPLAY-VERDICT | A12 | Sol (Codex acct 2, W1-sol-win-trust) | P2 | real-fixed #990 | Obsolete decisive replay under clock skew could refuse current rotated session [apps/windows/crates/tono-core/src/auth.rs:1611] |

### R3-W1hi (finished 21:05 MT; 28 hypotheses, 10 FP, PRs: #974 #976 #978 #986 #988)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| WIN-RECOVERY-AI-HOLD-OMISSION | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P1 | real-fixed #974 (merged) | Crash/corrupt/unhealthy and unproven-Core releases omit the secondary AI hold [apps/windows/service/src/core/windows_kill_switch.rs:2946] |
| W1-DIRECT-EXPIRY | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P1 | duplicate #777 / #926 | Committed DIRECT heartbeat expiry remains exact Blocked [apps/windows/service/src/core/windows_kill_switch.rs:3428] |
| W1-WANTED-NO-CORE | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P1 | duplicate #740 (now merged) | Restored wanted block can outlive its Core [apps/windows/service/src/core/windows_kill_switch.rs:2800] |
| W1-LOCK-POISON | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P2 | duplicate #812 (now merged) | ARMED poison can panic lock IPC [apps/windows/service/src/core/windows_kill_switch.rs:1910] |
| WIN-FAILED-ARM-AI-HOLD | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P2 | real-fixed #976 (merged) | A failed WFP install removes the existing narrow AI hold [apps/windows/service/src/core/windows_kill_switch.rs:1216] |
| W1-LIVE-CORE-RELEASE | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P2 | unverified needs unavailable App plus broken Core and native proof that TUN routes still blackhole after WFP release | A live broken Core can survive a WFP-only recovery release [apps/windows/service/src/core/windows_kill_switch.rs:2737] |
| WIN-UPDATE-FAILURE-AI-HOLD | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P1 | real-fixed #978 (merged) | Automatic failed-update emergency release removes the secondary AI layer [apps/windows/service/src/bin/install_service/update_executor.rs:586] |
| W1-UNWANTED-UNLINK-DNS | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P2 | unverified skipped cleanup is source-proven; user harm needs exceptional DNS residue plus independent unlink error; native/fault evidence deferred | An undeletable unwanted intent can skip remaining DNS restoration [apps/windows/service/src/core/windows_kill_switch.rs:3138] |
| W1-UNVERIFIED-OWNER-RETIRE | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P2 | duplicate documented adjacent #777 limitation; interrupted startup plus record error | Failed unverified-owner retirement can retain healthy Blocked policy [apps/windows/service/src/core/windows_kill_switch.rs:3349] |
| W1-RESTORED-RELOCK | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P1 | duplicate #740 Core-proof deadline and non-strict release | A failed restored re-lock consumes its retry flag [apps/windows/service/src/core/windows_kill_switch.rs:3386] |
| W1-UPDATE-TOMBSTONE | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P2 | duplicate recorded #858 limitation; restart failure plus independent write error | Automatic failed-update release can be refused by tombstone write failure [apps/windows/service/src/bin/install_service/update_executor.rs:586] |
| W1-PERSISTENT-PERMITS | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P1 | duplicate #753; main makes infrastructure permits persistent | Persistent deny can outlive nonpersistent DHCP/loopback permits [apps/windows/service/src/core/wfp_model.rs:287] |
| WIN-STARTUP-RETRY-RECONNECT | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P2 | real-fixed #986 (merged) | Successful startup-release retry deletes the crash reconnect marker [apps/windows/service/src/core/windows_kill_switch.rs:513] |
| WIN-SELECTIVE-LATE-WORKER | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P2 | real-fixed #988 (merged) | Timed-out native delete/apply can overwrite a newer AI hold or Restore [apps/windows/service/src/core/selective_layer.rs:24] |
| W1-STATUS-MIXED | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P2 | duplicate F520-1; existing generation and double-reading guard; millisecond snapshot limitation | Service status can mix separately sampled Core/WFP state [apps/windows/service/src/core/status.rs:47] |
| W1-INHERITED-CORE-WINDOW | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P2 | duplicate #740; no distinct new ordinary trigger proved beyond existing proof-window behavior | A replacement arm could inherit an old Core-proof deadline [apps/windows/service/src/core/windows_kill_switch.rs:299] |
| W1-LATE-INTENT-RENAME | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P2 | duplicate BRICK-W11; unique temps/readback fixed shared corruption, later-than-readback rename remains documented | A timed-out rename could overwrite a successor intent [apps/windows/service/src/core/windows_kill_switch.rs:639] |
| W1-RECOVERY-CHECKPOINT | Windows WFP | Sol (Codex acct 2, R3-W1hi) | P2 | duplicate #740 guarded wanted-intent recovery; immediate/failed-replay/30-second Core proof release; no new permanent outage proved | Slow secondary hold expands the pre-tombstone crash window [apps/windows/service/src/core/windows_kill_switch.rs:2745] |

### R3-W5gap (finished 21:05 MT; 32 hypotheses, 21 FP, PRs: #982 #985 #987 #989)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| WIN-DNS-RESTORE-SNAPSHOT-WRITE | W5 DNS facade | Sol (Codex acct 2, R3-W5gap) | P1 | real-fixed #982 | Snapshot refresh write failure skips resolver-policy restore and blocks disarm [apps/windows/service/src/core/dns/mod.rs:2731] |
| BRICK-W7 | W5 restore proof | Sol (Codex acct 2, R3-W5gap) | P1 | duplicate of known BRICK-W7 | Live restore verifier reads the registry [apps/windows/service/src/core/dns/engine.rs:1323] |
| WIN-DNS-SNAPSHOT-DELETE-BLOCKS | W5 DNS facade | Sol (Codex acct 2, R3-W5gap) | P1 | duplicate of #769 and #827 | Snapshot delete failure blocks disarm [apps/windows/service/src/core/dns/mod.rs:2812] |
| WIN-STOPCLASH-UNRECORDED | W5 DNS callers | Sol (Codex acct 2, R3-W5gap) | P1 | duplicate of #930 | Failed stop bookkeeping skips DNS restore [apps/windows/service/src/core/server/handlers.rs:842] |
| WIN-DNS-DOH-CAPTURE-DELETE | W5 DNS engine | Sol (Codex acct 2, R3-W5gap) | P1 | real-fixed #985 | Capture deletion failure aborts restored resolver policy and disarm [apps/windows/service/src/core/dns/engine.rs:1634] |
| WIN-DNS-DOH-NEW-TEMPLATE | W5 DNS engine | Sol (Codex acct 2, R3-W5gap) | P2 | real-fixed #987 | New adapter DoH flags suppressed without saved originals [apps/windows/service/src/core/dns/engine.rs:481] |
| WIN-DNS-SPACE-LIST | W5 DNS parsing | Sol (Codex acct 2, R3-W5gap) | P2 | real-fixed #989 | Documented space-delimited original DNS lists rejected by compatibility apply [apps/windows/service/src/core/dns/mod.rs:550] |
| W5-PROFILE-ORIGINALS | W5 originals | Sol (Codex acct 2, R3-W5gap) | — | unverified Windows profile-transition evidence required | SSID change may restore old ProfileNameServer [apps/windows/service/src/core/dns/mod.rs:879] |
| W5-NETSH-LATE | W5 engine processes | Sol (Codex acct 2, R3-W5gap) | — | unverified native subprocess timing required; related R680 limitation | Timed-out netsh descendant may commit DNS6 late [apps/windows/service/src/core/dns/engine.rs:827] |
| W5-SCOPED-V6 | W5 engine parsing | Sol (Codex acct 2, R3-W5gap) | — | unverified ordinary registry producer for percent scope suffix not established | Scoped IPv6 resolver may be rejected by script guard [apps/windows/service/src/core/dns/engine.rs:1067] |
| BRICK-W11-DNS | W5 snapshot writes | Sol (Codex acct 2, R3-W5gap) | P2 | duplicate of known BRICK-W11 mechanism; DNS extension and native timing untested | Abandoned shared-temp replacement can publish a stale DNS snapshot after release [apps/windows/service/src/core/dns/mod.rs:1403] |

### R3-M10gap (finished 21:05 MT; 27 hypotheses, 22 FP, PRs: #991 #993)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| M10-H07 | macOS native update | Sol (Codex acct 2, R3-M10gap) | P3 | duplicate of #785 | Retirement error retains released protection display [AppState+NativeUpdate.swift:134] |
| M10-H08 | macOS native update | Sol (Codex acct 2, R3-M10gap) | P2 | duplicate of #795 | Protected Offline successor cannot commit [RuntimeCleanup.swift:217] |
| M10-H09 | macOS native update | Sol (Codex acct 2, R3-M10gap) | P2 | duplicate of #891 | Monitor releases PF during staging before suspension [AppState+NativeUpdate.swift:9] |
| MAC-UPDATE-CANCELLED-RELOAD | macOS native update | Sol (Codex acct 2, R3-M10gap) | P2 | real-fixed #991 | Cancelled reload handle survives failed update retirement [AppState+NativeUpdate.swift:34] |
| MAC-UPDATE-METADATA-DEADLINE | macOS update download | Sol (Codex acct 2, R3-M10gap) | P2 | real-fixed #993 | Trickling metadata holds the update-check gate for days [NativeUpdateDownload.swift:23] |

### R3-M6M8 (finished 21:19 MT; 36 hypotheses, 28 FP, PRs: #1001)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| R3CONN-DUP01 | M6 | Sol (Codex acct 2, R3-M6M8) | P1 | duplicate #720 | Armed failure holds all traffic [AppState+Connect.swift:643] |
| R3CONN-DUP02 | M6 | Sol (Codex acct 2, R3-M6M8) | P1 | duplicate #760 | Released PF health and browser DNS hold [AppState+Connect.swift:1589] |
| R3CONN-DUP03 | M8 | Sol (Codex acct 2, R3-M6M8) | P2 | duplicate #795 | Protected Offline update commit remains pending [RuntimeCleanup.swift:218] |
| R3CONN-DUP04 | M8 | Sol (Codex acct 2, R3-M6M8) | P2 | duplicate #991 | Cancelled reload handle survives update suspension [AppState+NativeUpdate.swift:38] |
| MAC-UPDATE-WAKE-RETIREMENT | M8 | Sol (Codex acct 2, R3-M6M8) | P2 | real-fixed #1001; CI pending | Surviving wake task reconnects after explicit update release and retirement [AppState+NativeUpdate.swift:36] |
| R3CONN-DUP05 | M6 | Sol (Codex acct 2, R3-M6M8) | P2 | duplicate #720 replaces this branch with unarmed recovery | Missing-TUN release retires its own reconnect intent [AppState+Connect.swift:1494] |
| R3CONN-DEC01 | M6 | Sol (Codex acct 2, R3-M6M8) | P2 design | real-unfixed decision item; deliberate teardown, helper watchdog releases with merged #738 selective layer; preserving the live session needs a product decision | Supplemental DNS conflict deliberately stops core and holds general traffic [AppState+Connect.swift:2385] |
| R3CONN-DUP06 | M8 | Sol (Codex acct 2, R3-M6M8) | P2 design | duplicate documented behavior in #854; helper fallback already tracked | Quit metadata-query error or deadline leaves protection held [AppDelegate.swift:326] |

### R3-A2A4 (finished 21:33 MT; 40 hypotheses, 25 FP, PRs: #1003 #1010)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| WIN-MONITOR-AI-HOLD-OMISSION | A3 | Sol (Codex acct 2, R3-A2A4) | P1 | real-fixed #1003 (CI pending) | Automatic health release removes the secondary AI hold [connection/monitor.rs:1391] |
| R3-A2-06 | A2 | Sol (Codex acct 2, R3-A2A4) | — | duplicate WIN-HEAL-SIGNOUT-DIAL #874 | Heal retains another account dial [connection/heal.rs:29] |
| R3-A2-07 | A2 | Sol (Codex acct 2, R3-A2A4) | — | duplicate #798 | Recovery preflight connects deselected node [connection/heal.rs:78] |
| R3-A2-08 | A2 | Sol (Codex acct 2, R3-A2A4) | — | duplicate #798 | Self-heal double release [connection.rs:263] |
| R3-A2-09 | A2 | Sol (Codex acct 2, R3-A2A4) | P2? | unverified narrow race; no ordinary trigger proved | Stale failure clears successor auth tunnel port [connection.rs:639] |
| R3-A4-01 | A4 | Sol (Codex acct 2, R3-A2A4) | — | duplicate acknowledged follow-up WIN-HY2-HOME-UDP-LEAK #783 | HY2 DIRECT graph expects absent generic UDP reject [connection/direct.rs:973] |
| R3-A4-02 | A4 | Sol (Codex acct 2, R3-A2A4) | — | duplicate #786 | Policy revision stops heartbeat [connection/direct.rs:62] |
| R3-A4-03 | A4 | Sol (Codex acct 2, R3-A2A4) | — | duplicate #786 | Suffix-only activates empty DIRECT graph [connection/direct.rs:495] |
| R3-A4-04 | A4 | Sol (Codex acct 2, R3-A2A4) | — | duplicate #926 | Failed DIRECT renewal blocks general network [connection/direct.rs:82] |
| R3-A4-05 | A4 | Sol (Codex acct 2, R3-A2A4) | — | duplicate #898 | Activation reload stalls Restore [connection/direct.rs:1250] |
| R3-A4-06 | A4 | Sol (Codex acct 2, R3-A2A4) | — | duplicate #787 | Routing changes leave stale runtime permits [catalog_sync.rs:197] |
| R3-A4-07 | A4 | Sol (Codex acct 2, R3-A2A4) | — | duplicate #900 | Signed paths survive fresh full tunnel [connection.rs:308] |
| R3-A4-15 | A4 | Sol (Codex acct 2, R3-A2A4) | P2? | unverified ordinary old request ends on Core stop; successor overlap not proved | Stale optional skip overwrites replacement metadata [connection/direct.rs:1497] |
| R3-A4-16 | A4 | Sol (Codex acct 2, R3-A2A4) | P3? | unverified route is unknown; attribution semantics need decision | Empty chains attribution disagrees with frontend [route_ledger.rs:46] |
| WIN-CONNECT-FAILURE-AI-HOLD-OMISSION | A2/A3 | Sol (Codex acct 2, R3-A2A4) | P1 | real-fixed #1010 (CI pending) | Failed protected connect/cold switch performs one plain release without AI hold [connection.rs:680] |

### R3-C4E1 (finished 21:33 MT; 41 hypotheses, 35 FP, PRs: #1009 #1015)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| EXIT-CLI-EXCEPTION-INVENTORY | E1 | Sol (Codex acct 2, R3-C4E1) | P1 | real-fixed #1009 | CLI timeout or filesystem exception drops partial client inventory; later revocation misses clients [services/exit-agent/reconcile_and_report.py:1153] |
| MAC-ASSISTANT-DIRECT-GAP | C4 caller | Sol (Codex acct 2, R3-C4E1) | P1 | duplicate of #867 | Native DIRECT can capture AI without residential hop [apps/macos/Tono/Core/ConfigPipeline+Runtime.swift] |
| E1-HY2-LEDGER-MISSING | E1 | Sol (Codex acct 2, R3-C4E1) | P2 | duplicate of #914 recovery boundary plus second independent failure | Ledger loss plus HY2 failure can retain raw lifetime [services/exit-agent/reconcile_and_report.py:1873] |
| SOL-C4-QUOTA-RETENTION-REWIND | C4 | Sol (Codex acct 2, R3-C4E1) | P2 | real-fixed #1015; ops display only; no production incident claim | Null final metric samples discard last valid counter at retention; fallback rebills older cumulative bytes [services/control-plane/src/ops/quota.ts:438] |
| SOL-C4-ACTIVITY-OVERLAP | C4 | Sol (Codex acct 2, R3-C4E1) | P3 | real-unfixed: interval/aggregation decision related O1-ACTIVITY-HOUR-COLLISION; source trace only; ops only | 22-minute windows every20 minutes sum beyond60 minutes for one device [services/control-plane/src/ops/customers.ts:178] |
| SOL-C4-CYCLE-INSERT-GAP | C4 | Sol (Codex acct 2, R3-C4E1) | — | duplicate: fixed #852, successor insert and old close atomic batch | A failed successor insert could leave an expired cycle closed without successor [services/control-plane/src/ops/quota-cycle.ts:86] |
