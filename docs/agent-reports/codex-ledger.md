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

### R3-A11 (finished 21:46 MT; 42 hypotheses, 34 FP, PRs: )
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| A11-H01 | sing-box | Sol (Codex acct 2, R3-A11) | — | duplicate #871; dormant compiler has no production callers | No-home process DIRECT could precede AI protection [apps/windows/crates/tono-core/src/sing_box/runtime.rs:274] |
| A11-H02 | sing-box | Sol (Codex acct 2, R3-A11) | — | duplicate #783; dormant gap already recorded | HY2 assistant UDP bypasses residential TCP route [apps/windows/crates/tono-core/src/sing_box/runtime.rs:275] |
| A11-H03 | sing-box | Sol (Codex acct 2, R3-A11) | — | duplicate #203 migration blocker; dormant compiler | Stock core rejects emitted DER certificate pin field [apps/windows/crates/tono-core/src/sing_box/runtime.rs:203] |
| A11-H11 | config | Sol (Codex acct 2, R3-A11) | — | duplicate #871; current main emits AI guards before signed-app DIRECT | Signed-app DIRECT might win over AI domains/IPs [apps/windows/crates/tono-core/src/config.rs:1135] |
| A11-H12 | config | Sol (Codex acct 2, R3-A11) | — | duplicate #783; current main rejects matching assistant UDP before DIRECT and MATCH | HY2 UDP might miss required home route [apps/windows/crates/tono-core/src/config.rs:1080] |
| A11-H23 | node | Sol (Codex acct 2, R3-A11) | — | duplicate accepted-design D6; Worker rejects mismatch | HY2 protocol might disagree with suffix-derived transport [apps/windows/crates/tono-core/src/node.rs:181] |
| A11-H24 | node | Sol (Codex acct 2, R3-A11) | — | duplicate PERF-CONNECT-1; config proxy_mapping supplies chrome | Missing Reality fingerprint might break connection [apps/windows/crates/tono-core/src/node.rs:347] |
| A11-H35 | config/policy | Sol (Codex acct 2, R3-A11) | — | duplicate #797 protected overlap guards | Trusted DIRECT policy might insert protected AI host or parent suffix [apps/windows/crates/tono-core/src/config.rs:1222] |

### R3-M9M11 (finished 21:46 MT; 30 hypotheses, 22 FP, PRs: #1008 #1016 #1019)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| R3CFG-H01 | M9 | Sol (Codex acct 2, R3-M9M11) | — | duplicate #867 | Assistant domain/IP/process DIRECT guard gap [ConfigPipeline+Runtime.swift:694] |
| R3CFG-H10 | M9 | Sol (Codex acct 2, R3-M9M11) | — | duplicate #958 | Web-direct real DNS loses hostname routing [ConfigPipeline+SingBoxProduct.swift:169] |
| MAC-ROTATED-TOKEN-DURABILITY | M11 | Sol (Codex acct 2, R3-M9M11) | P1 | real-fixed #1008 | Rotated token write refusal remains unpersisted until next refresh [Services/TonoAPIClient.swift:591] |
| R3CFG-H11 | M11 | Sol (Codex acct 2, R3-M9M11) | — | duplicate #796 guards obsolete bearer verdicts | Delayed bearer refusal suspends newer session [Services/TonoAPIClient.swift:800] |
| R3CFG-H18 | M11 | Sol (Codex acct 2, R3-M9M11) | — | duplicate #314/#329; server predecessor replay grace exists | Lost renewal response permanently destroys session [services/control-plane/src/sessions.ts:75] |
| R3CFG-H19 | M11 | Sol (Codex acct 2, R3-M9M11) | — | duplicate H11-F2/#409 with hardware-anchor mitigation | Migrated Keychain shares old device identity [Services/KeychainStore.swift:90] |
| MAC-WEB-PINS-SUFFIX-STALE | M9 | Sol (Codex acct 2, R3-M9M11) | P2 | real-unfixed coordinated DNS/pin design needed to avoid documented whole-session reload interruption | Suffix presence disables refresh of web pins still used for dialing [Services/AppState+Connect.swift:1726] |
| MAC-DASHSCOPE-DIRECT-COVERAGE | M9 | Sol (Codex acct 2, R3-M9M11) | P1 | real-unfixed policy migration/recovery-domain coverage requires coordinated scope; helper edits forbidden | Dedicated Qwen model API names match broad Alibaba DIRECT suffix [Core/ConfigPipeline.swift:114] |

### R3-M5M7 (finished 21:46 MT; 34 hypotheses, 22 FP, PRs: )
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| M5M7-H02 | M7 | Sol (Codex acct 2, R3-M5M7) | P3 | duplicate #854 | Concurrent scene loads apply the disk snapshot twice [apps/macos/Tono/Services/AppState+Persistence.swift:22] |
| M5M7-H07 | M5 | Sol (Codex acct 2, R3-M5M7) | P0 | duplicate user ALREADY-KNOWN SIGPIPE in HelperManager.writeAll | Helper socket write can deliver SIGPIPE [apps/macos/Tono/Core/HelperManager.swift:1396] |
| M5M7-H08 | M7 | Sol (Codex acct 2, R3-M5M7) | P2 | duplicate #1001 | Wake owner survives native-update release and reconnects [apps/macos/Tono/Services/AppState.swift:740] |
| MAC-QUIT-AI-HOLD | M5/M7 | Sol (Codex acct 2, R3-M5M7) | P1 | real-unfixed helper release-disposition contract required; helper edits forbidden for this slot; older explicit-disconnect design needs reconciliation with TOP rule for stop | Normal Quit removes the selective AI blocking floor through plain helper disarm [apps/macos/Tono/App/AppDelegate.swift:343] |
| M5M7-H18 | M5 | Sol (Codex acct 2, R3-M5M7) | — | unverified no ordinary launchctl hang trigger proved; retained hardening candidate | Unbounded launchctl wait could wedge cleanup [apps/macos/Tono/Core/HelperManager.swift:680] |
| M5M7-H19 | M5 | Sol (Codex acct 2, R3-M5M7) | — | unverified no surviving inherited writer demonstrated; helper daemon uses /dev/null | Installer stderr pipe hangs after AppleScript exit [apps/macos/Tono/Core/HelperManager.swift:388] |
| M5M7-H20 | M5 | Sol (Codex acct 2, R3-M5M7) | P2 | duplicate #759 | Failed silent upgrade delivery incurs a 45-second poll [apps/macos/Tono/Core/HelperManager.swift:1210] |
| M5M7-H21 | M5 | Sol (Codex acct 2, R3-M5M7) | P1 | duplicate #840; current main handles emptyResponse and socketFailed | Launch update-status timeout bypasses helper recovery [apps/macos/Tono/Core/RuntimeCleanup.swift:263] |
| M5M7-H22 | M5 | Sol (Codex acct 2, R3-M5M7) | P1 | duplicate #794; current main has standard release cleanup | Abandoned helper replacement retains PF after Core stop [apps/macos/Tono/Core/HelperManager.swift:259] |
| M5M7-H31 | M7 | Sol (Codex acct 2, R3-M5M7) | — | unverified ordinary corruption path not proved; optional policy refresh does not block sign-in or protected connectivity | Decodable corrupt policy metadata can reject a matching revision [apps/macos/Tono/Services/AppState+Catalog.swift:537] |
| M5M7-H32 | M5 | Sol (Codex acct 2, R3-M5M7) | P2 | duplicate #795 | Protected Offline native update never commits after fail-open launch [apps/macos/Tono/Core/RuntimeCleanup.swift:224] |
| M5M7-H33 | M5 | Sol (Codex acct 2, R3-M5M7) | P2 | duplicate #756; current main restores after an available recheck | Helper repair skips snapshotless DNS restoration [apps/macos/Tono/Core/RuntimeCleanup.swift:410] |

### R3-W3W9gap (finished 22:00 MT; 29 hypotheses, 18 FP, PRs: #994 #999 #1004 #1012 #1022 #1026)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| WIN-PROXY-RESET-JOIN | W3 | Sol (Codex acct 2, R3-W3W9gap) | P2 | duplicate #925 fixed in current source | Concurrent proxy clear returns early [app/core/sysopt.rs:109] |
| WIN-STARTCLASH-FAILURE | W3 | Sol (Codex acct 2, R3-W3W9gap) | P1 | duplicate #769 | Disk-full log setup failure leaves WFP armed [logger.rs:34] |
| BRICK-W3 | W9 | Sol (Codex acct 2, R3-W3W9gap) | P1 | duplicate known BRICK-W3; no fix in this hunt | Failed disarm still deletes SCM registration and Service binary [uninstall_service.rs:650] |
| BRICK-W4 | W9 | Sol (Codex acct 2, R3-W3W9gap) | P1 | duplicate documented BRICK-W4 limitation; decision boundary | Explicit uninstall exit4 permits inexact/stopped-resolver DNS [uninstall_service.rs:584] |
| WIN-CORE-REAPER-PID-REUSE | W3 | Sol (Codex acct 2, R3-W3W9gap) | P2 | real-fixed #994; merged; exact-head ci-gate and native Windows service passed | Orphan sweep discards creation identity and can kill reused PID [process.rs:637 -> process.rs:565] |
| WIN-WATCHDOG-TIMEOUT-PID-REUSE | W3 | Sol (Codex acct 2, R3-W3W9gap) | P2 | real-fixed #999; merged; baseline failed then 5 manager tests passed; exact-head ci-gate passed | Confirmed-dead Core PID remains while metadata/WFP cleanup waits [manager.rs:826 -> 1057 -> 1101] |
| WIN-SCM-PID-FALLBACK | W9 | Sol (Codex acct 2, R3-W3W9gap) | P2 | real-fixed #1004; merged; 39 Linux bin tests and exact-head native ci-gate passed | Stale PID-file escalation can target another process [bin/shared/mod.rs:160] |
| WIN-CORE-JOB-SPAWN-WINDOW | W3 | Sol (Codex acct 2, R3-W3W9gap) | P2 | real-unfixed documented in merged #1026; atomic Windows launcher/native regression unfinished; SCM restart sweep mitigates; P2 | Service crash between Core creation and Job assignment leaves an unbound Core [manager.rs:1190 -> manager.rs:1225 (ad53abb6)] |
| WIN-WATCHDOG-ABORT-PID-REUSE | W3 | Sol (Codex acct 2, R3-W3W9gap) | P2 | real-fixed #1012; merged; actual timeout baseline failed then 6 manager tests passed; exact-head ci-gate passed | Abort closes live Core Job before raw PID fallback can reopen [manager.rs:1099 -> manager.rs:1106] |
| WIN-OWNER-TAKEOVER-STALE-PID | W3 caller | Sol (Codex acct 2, R3-W3W9gap) | P2 | real-fixed #1022; merged; baseline failed then 4 owner tests passed; exact-head native ci-gate passed | Owner exits during health wait but raw old PID still killed [owner.rs:57 -> owner.rs:78] |
| WIN-OWNER-CLEANUP-LIVE-PIDFILE | W3 caller | Sol (Codex acct 2, R3-W3W9gap) | P2 | real-fixed #1022; merged; baseline failed then 4 owner tests passed; exact-head native ci-gate passed | Failed takeover deletes a successor owner PID file before lock acquisition [owner.rs:85 -> owner.rs:87] |

### R3-M12 (finished 22:00 MT; 36 hypotheses, 31 FP, PRs: #1027)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| M12-DUP01 | DNS | Sol (Codex acct 2, R3-M12) | P1 | duplicate #886 | Cached public DNS burst ends protected query too early [ProtectedSystemResolver.swift:170] |
| M12-DUP02 | sidecar | Sol (Codex acct 2, R3-M12) | P3 | duplicate #788 | Stale reused legacy PID blocks account startup [TonoSidecarService.swift:302] |
| M12-DUP03 | websocket | Sol (Codex acct 2, R3-M12) | P3 | duplicate #799 merged | Receive errors leave traffic/connection feeds falsely live [CoreWebSocket.swift:96] |
| MAC-LOGS-PONG-UNSUPPORTED | websocket | Sol (Codex acct 2, R3-M12) | P2 | real-fixed #1027 (CI pending) | Unsupported log Pong watchdog causes false reconnects and retained Core subscriptions [apps/macos/Tono/Core/CoreWebSocket.swift:375 (baseline 262b1864)] |
| M12-DUP04 | websocket | Sol (Codex acct 2, R3-M12) | P2 | duplicate #762 | Old runtime log buffer publishes under successor route [CoreWebSocket.swift:235] |

### R3-W4W7 (finished 22:10 MT; 36 hypotheses, 22 FP, PRs: #1005 #1007 #1014 #1017 #1025)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| WIN-UNVERIFIED-STARTUP-AI-HOLD | W4 | Sol (Codex acct 2, R3-W4W7) | P1 | real-fixed #1005 (merged; CI passed) | Unverified startup crash cleanup releases without secondary AI hold [core/windows_kill_switch.rs:3410] |
| R3S-04 | W4 | Sol (Codex acct 2, R3-W4W7) | — | duplicate already fixed nonzero fatal exit | Healthy predecessor makes successor exit without SCM restart [bin/service.rs:446] |
| R3S-05 | W4 | Sol (Codex acct 2, R3-W4W7) | P2 | duplicate #994; owner takeover native timing unproven | Cleanup termination can act on reused PID [core/reconcile.rs:41] |
| R3S-11 | W4 | Sol (Codex acct 2, R3-W4W7) | — | duplicate #775 quarantine already merged | Unparseable runtime record wedges all Core starts [core/runtime.rs:98] |
| R3S-12 | W4 | Sol (Codex acct 2, R3-W4W7) | — | duplicate BRICK-W1 boot-session guard already merged | Reboot replays old run intent without user [core/desired.rs:249] |
| WIN-PREPARE-FAILURE-AI-HOLD | W7 | Sol (Codex acct 2, R3-W4W7) | P1 | real-fixed #1007 (merged; native CI passed); follow-up to #793 | Failed Prepare uses plain release and omits AI hold [core/update.rs:535] |
| WIN-SCM-STOP-AI-HOLD | W4 | Sol (Codex acct 2, R3-W4W7) | P1 | real-fixed #1014 (merged; native CI passed); selective follow-up to #792 | Automatic armed SCM Stop releases without AI hold [core/server/mod.rs:578] |
| WIN-COMMITTED-CLEANUP-RETRY | W7 | Sol (Codex acct 2, R3-W4W7) | P2 | real-fixed #1017 (merged; native sharing test passed twice) | Committed cleanup ignores locked rollback deletion and retires retry task [bin/install_service/update_executor.rs:768] |
| R3S-25 | W7 | Sol (Codex acct 2, R3-W4W7) | — | duplicate decision BRICK-W6; explicit protocol expiry | Expired update receipt prevents recovery grants [update_transaction.rs:324] |
| R3S-26 | W7 | Sol (Codex acct 2, R3-W4W7) | — | duplicate #858 documented crash-before-restart limitations | Published target recovery returns before restarting Service [bin/install_service/update_executor.rs:359] |
| R3S-27 | W7 | Sol (Codex acct 2, R3-W4W7) | — | duplicate BRICK-W9 subset; ordinary native trigger unproven | SCM recovery configuration error returns with Service stopped [bin/install_service/update_executor.rs:558] |
| R3S-32 | W7 | Sol (Codex acct 2, R3-W4W7) | — | duplicate #352 default ACL fix | TrustedInstaller default ACL rejects updates [core/update/security.rs:90] |
| R3S-33 | W7 | Sol (Codex acct 2, R3-W4W7) | — | duplicate-fixed #776 block_on_abandoning | Timed-out BFE work hangs installer Runtime drop [bin/install_service/update_executor.rs:262] |
| WIN-PREPARE-COMMITTED-BACKUPS | W7 | Sol (Codex acct 2, R3-W4W7) | P2 | real-fixed #1025 (merged; all CI passed; native regressions passed twice) | Later Prepare overwrites a committed attempt before retained backups are cleaned [core/update.rs:459] |

### R3-MacQuitHold (finished 22:10 MT; 3 hypotheses, 2 FP, PRs: #1031)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| MAC-QUIT-AI-HOLD | macOS Quit/helper | Sol (Codex acct 2, R3-MacQuitHold) | P1 | real-unfixed decision item #1031: documented explicit Disconnect full release requires reconciliation with TOP stop rule | Successful normal Quit removes the selective AI floor [apps/macos/Tono/App/AppDelegate.swift:350] |

### R3-E2T2 (finished 22:24 MT; 47 hypotheses, 33 FP, PRs: #995 #996 #997 #998 #1000 #1002 #1011 #1018 #1035)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| HY2-PROVISION-SPKI | E2 | Sol (Codex acct 2, R3-E2T2) | P1 | real-fixed #995; merged 140b5d9f, ci-gate passed | Provisioned HY2 source discards SPKI required by macOS [tooling/scripts/provision-reality-node.rb:445] |
| PROVISION-JOURNAL-BANNER | E2 | Sol (Codex acct 2, R3-E2T2) | P2 | real-fixed #996; merged 72a9c98d, ci-gate passed | No-entry journal banner rejects healthy restart; unreadable journal is accepted [tooling/scripts/remote/manage-tono-node-v2.sh:328] |
| PROVISION-ROLLBACK-MODE | E2 | Sol (Codex acct 2, R3-E2T2) | P2 | real-fixed #997; merged 857b9e73, ci-gate passed | Immutable snapshot permissions make writable-config rollback verification fail [tooling/scripts/remote/manage-tono-node-v2.sh:151] |
| CONNECT-BENCH-PARTIAL-CACHE | T2 | Sol (Codex acct 2, R3-E2T2) | P2 | real-fixed #998; merged 7e5c333a, ci-gate passed | Interrupted extraction poisons executable cache reused on retry [tooling/perf/connect-bench/bench.py:127] |
| CONNECT-BENCH-STARTUP-ORPHAN | T2 | Sol (Codex acct 2, R3-E2T2) | P2 | real-fixed #1000; merged 08aac566, ci-gate passed | Failed startup leaves benchmark child running and log open [tooling/perf/connect-bench/bench.py:571] |
| PROVISION-PENDING-SUCCESS-DURABILITY | E2 | Sol (Codex acct 2, R3-E2T2) | P2 | real-fixed #1002; merged 156a2536, ci-gate passed | Recovered remote success remains pending on disk and blocks enrollment [tooling/scripts/provision-tono-node.py:182] |
| HOME-AGENT-PEER-RETENTION-CAP | E2 | Sol (Codex acct 2, R3-E2T2) | P2 | real-unfixed; safe retention needs counter-continuity design, reporter undeployed | Lifetime peer baselines exceed 2000 cap and stop all fresh reports [services/home-agent/report_example.py:148] |
| HA-GENERATION | E2 | Sol (Codex acct 2, R3-E2T2) | — | duplicate; open issue #5 counter-generation design | Counter reset above the prior watermark can lose usage [services/home-agent/report_example.py:497] |
| HA-REPORT-400 | E2 | Sol (Codex acct 2, R3-E2T2) | — | duplicate; #899 refusal isolation is already on main | A permanently refused report wedges the queue [services/home-agent/report_example.py:604] |
| T2-HY2-HOME-UDP | T2 | Sol (Codex acct 2, R3-E2T2) | — | duplicate; known WIN-HY2-HOME-UDP-LEAK, Windows product uses mihomo | HY2 home UDP falls through to the selected exit [apps/windows/crates/tono-core/src/sing_box/runtime.rs:275] |
| MIGRATE-CURRENT-RESTORE | E2 | Sol (Codex acct 2, R3-E2T2) | — | duplicate; #845 rollback guard is already on main | Failed current-link switch might strand the node [tooling/scripts/remote/migrate-node-to-release-layout.sh:77] |
| MIGRATE-STALE-CONFIG | E2 | Sol (Codex acct 2, R3-E2T2) | — | duplicate; #913 restaging and comparison is already on main | Migration might activate stale staged config [tooling/scripts/remote/migrate-node-to-release-layout.sh:63] |
| TCP-TUNE-FALSE-SUCCESS | E2 | Sol (Codex acct 2, R3-E2T2) | — | duplicate; #910 checks effective live values | TCP tuning might report success without live settings [tooling/scripts/remote/tune-tono-tcp.sh:77] |
| PROVISION-REPO-ROOT | E2 | Sol (Codex acct 2, R3-E2T2) | — | duplicate; #842 corrected parents[2] on main | Provisioner resolves the wrong repository root [tooling/scripts/provision-tono-node.py:20] |

### R3-W2W3 (finished 22:24 MT; 35 hypotheses, 28 FP, PRs: #PR#1032)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| R3-WFP-N02 | W2 | Sol (Codex acct 2, R3-W2W3) | — | duplicate #753 persistent floor and namespace v12 | Reboot keeps block but loses infrastructure permits [wfp/mod.rs:437] |
| R3-WFP-N09 | W2 | Sol (Codex acct 2, R3-W2W3) | — | duplicate #676 presence and virtual/type proof | Tunnel alias admits absent or physical interface [wfp/mod.rs:1040] |
| R3-MGR-M01 | W3 | Sol (Codex acct 2, R3-W2W3) | — | duplicate #1004 single guard spans bounded retry | Failed-child retry re-locks its own mutex [manager.rs:779] |
| R3-MGR-M02 | W3 | Sol (Codex acct 2, R3-W2W3) | — | duplicate #1012 cached process identity required | Watchdog abort kills a reused PID [manager.rs:1130] |
| WIN-DHCPV6-RELAY-SOURCE | W2 | Sol (Codex acct 2, R3-W2W3) | P2 | real-unfixed decision item: safe server/service identity required before widening intentional strict permit; native Windows unrun | Inbound DHCPv6 reply permits exclude legitimate non-link-local relay sources [wfp_model.rs:451] |
| R3-WFP-DHCP-IDENTITY | W2 | Sol (Codex acct 2, R3-W2W3) | — | duplicate TW-OpenAI-1 / H1-F6 | DHCP ports have no service identity [wfp_model.rs:435] |
| WIN-CORE-EXHAUSTION-HEALTHY-BLOCK | W3 | Sol (Codex acct 2, R3-W2W3) | P2 | real-fixed #1032 (merged fe0f1b77); regression failed before/passed after; strict and successor-arm guards preserved | Exhausted Core retries leave healthy Blocked WFP with no Core while App is unavailable [manager.rs:923] |

### R3-W1lo (finished 22:24 MT; 29 hypotheses, 17 FP, PRs: #1021 #1024 #1029)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| WIN-LIVE-BOOTSTRAP-APP-DEATH | W1 | Sol (Codex acct 2, R3-W1lo) | P0 | real-fixed #1021 (merged) | App death during first Connect leaves a healthy Bootstrap block forever [windows_kill_switch.rs:1497] |
| R3KS1-PENDING-EXPIRY | W1 | Sol (Codex acct 2, R3-W1lo) | P1 | real-unfixed decision boundary; #777/#926 deliberately exclude incomplete phases | Uncommitted DIRECT expiry retains healthy Blocked [windows_kill_switch.rs:3489] |
| R3KS1-STRICT-WATCHDOG | W1 | Sol (Codex acct 2, R3-W1lo) | decision | real-unfixed documented decision 027; preserve existing behavior | Strict watchdog releases after 30 unhealthy ticks [windows_kill_switch.rs:2965] |
| R3KS1-SELECTIVE-WORKER-HANG | W1 | Sol (Codex acct 2, R3-W1lo) | P2 | duplicate #988 native-failure limitation; bounded async waits | Hung native child can strand future selective operations [selective_layer.rs:281] |
| R3KS1-NRPT-BYPASS | W1 | Sol (Codex acct 2, R3-W1lo) | decision | duplicate SFO-1 accepted design | Cached answers DoH literal IPs bypass suffix hold [selective_fail_open.rs:36] |
| R3KS1-SELECTIVE-REMOVAL | W1 | Sol (Codex acct 2, R3-W1lo) | — | duplicate #976; removal follows successful exact replacement | Arming removes the hold before replacement protection exists [windows_kill_switch.rs:1239] |
| WIN-CORRUPT-STARTUP-RELEASE-RETRY | W1 | Sol (Codex acct 2, R3-W1lo) | P2 | real-fixed #1029 (merged); recovered valid-wanted readback remains a conservative-admission limitation | Ownerless corrupt startup abandons broad-filter removal after transient native failure [windows_kill_switch.rs:3005] |
| WIN-DISCONNECT-CRASH-RETRY-RECONNECT | W1 | Sol (Codex acct 2, R3-W1lo) | P2 | real-fixed #1024 (merged) | Pending crash tombstone overwrites a successful Disconnect durable reconnect=false [windows_kill_switch.rs:2756] |
| R3KS1-COMMITTED-DIRECT-EXPIRY | W1 | Sol (Codex acct 2, R3-W1lo) | P0 | duplicate #777/#926 | App death or renewal failure leaves committed DIRECT Blocked [windows_kill_switch.rs:2555] |
| R3KS1-INTERRUPTED-FIRST-CONNECT | W1 | Sol (Codex acct 2, R3-W1lo) | P0 | duplicate #1005 | Service restart after interrupted first Connect omits AI hold [windows_kill_switch.rs:3486] |
| R3KS1-LATE-SELECTIVE-WORKER | W1 | Sol (Codex acct 2, R3-W1lo) | P1 | duplicate #988 revisioned single-worker reconciliation | Late selective apply overwrites a newer remove request [selective_layer.rs:74] |
| R3KS1-RECOVERY-AI-OMISSION | W1 | Sol (Codex acct 2, R3-W1lo) | P0 | duplicate #974 | Corrupt or unproven-session recovery drops secondary AI hold [windows_kill_switch.rs:2786] |

### R3-M1M3 (finished 22:47 MT; 36 hypotheses, 16 FP, PRs: #1028 #1030 #1033)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| MAC-FAILED-BARRIER-AI-HOLD | M2 | Sol (Codex acct 2, R3-M1M3) | P1 | real-fixed #1028 | Failed automatic PF commit releases without secondary AI hold [tooling/scripts/core-helper/KillSwitchManager.swift:561] |
| MAC-ORPHAN-BOOTSTRAP-AI-HOLD | M1 | Sol (Codex acct 2, R3-M1M3) | P1 | real-fixed #1028 | Merged orphan crash release omits secondary AI hold [tooling/scripts/core-helper/SocketServer.swift:328] |
| MAC-DNS-PREFS-LOCK | M3 | Sol (Codex acct 2, R3-M1M3) | P1 | real-fixed #1030 | DNS preferences lock contention hangs helper and recovery [tooling/scripts/core-helper/ProtectedDNSManager.swift:974] |
| MAC-DNS-APPLY-RETRY | M3 | Sol (Codex acct 2, R3-M1M3) | P1 | real-fixed #1033 | Commit-before-Apply failure makes retry discard DNS recovery without applying [tooling/scripts/core-helper/ProtectedDNSManager.swift:319] |
| M1-UPGRADE-FIFO | M1 | Sol (Codex acct 2, R3-M1M3) | P2 | duplicate #979/#928; remaining signed-probe limit already recorded | Silent upgrade source/probe can block the serialized helper [tooling/scripts/core-helper/SocketServer.swift:462] |
| M1-CORE-ALIVE-HANG | M1 | Sol (Codex acct 2, R3-M1M3) | — | unverified no ordinary hang trigger proved; committed Core survival intentional | Process-only watchdog leaves a hung live Core protected [tooling/scripts/core-helper/SocketServer.swift:236] |
| M2-PF-PLACEHOLDER-RELEASE | M2 | Sol (Codex acct 2, R3-M1M3) | P1 | duplicate #761; current release catches housekeeping failure | Placeholder write failure prevents PF release [tooling/scripts/core-helper/KillSwitchManager.swift:676] |
| M2-PF-TOKEN-FORGET | M2 | Sol (Codex acct 2, R3-M1M3) | P2 | duplicate #979/#895 | Failed pfctl -X forgets enable token [tooling/scripts/core-helper/KillSwitchPF.swift:1263] |
| M2-LAN-DNS-SCOPE | M2 | Sol (Codex acct 2, R3-M1M3) | P2 | duplicate #979/#894 | New physical NIC escapes arm-time LAN DNS scope [tooling/scripts/core-helper/KillSwitchPF.swift:178] |
| M2-LOOKUP-KILL-WAIT | M2 | Sol (Codex acct 2, R3-M1M3) | — | unverified ordinary stalled resolver terminates; kernel hang trigger unproved | Resolver waits indefinitely after SIGKILL [tooling/scripts/core-helper/KillSwitchPF.swift:1763] |
| M2-STATE-LSTAT-EIO | M2 | Sol (Codex acct 2, R3-M1M3) | — | unverified ordinary single-failure outage not proved | State lstat error looks absent and prevents watchdog release [tooling/scripts/core-helper/KillSwitchManager.swift:1210] |
| M3-DNS-STATUS-ID | M3 | Sol (Codex acct 2, R3-M1M3) | P2 | duplicate #979/#893 | Renamed service reports wrong DNS status by display name [tooling/scripts/core-helper/ProtectedDNSManager.swift:561] |
| M3-STALE-CORE-PID | M3 | Sol (Codex acct 2, R3-M1M3) | P2 | duplicate #979/#897 | Stale Core termination signals reused PID [tooling/scripts/core-helper/CoreManager.swift:395] |
| M3-DNS-COUNT-CAP | M3 | Sol (Codex acct 2, R3-M1M3) | P1 | duplicate #765 | Over-eight DNS snapshot cannot restore [tooling/scripts/core-helper/ProtectedDNSManager.swift:83] |
| M3-FOREIGN-LOOPBACK | M3 | Sol (Codex acct 2, R3-M1M3) | P2 | duplicate BRICK-M12; ownership ambiguity is documented | Foreign exact loopback DNS remains after owner-only restore [tooling/scripts/core-helper/ProtectedDNSManager.swift:355] |
| M3-NETWORKSETUP-STALL | M3 | Sol (Codex acct 2, R3-M1M3) | — | unverified ordinary fallback-plus-stall trigger not proved | Legacy DNS subprocess hangs helper [tooling/scripts/core-helper/ProtectedDNSManager.swift:1020] |
| M3-SNAPSHOT-DURABILITY | M3 | Sol (Codex acct 2, R3-M1M3) | — | unverified narrow persistence window; APFS behavior not tested | Snapshot rename loses recovery on power loss [tooling/scripts/core-helper/ProtectedDNSManager.swift:719] |
| M3-DIAGNOSTIC-CLOSE | M3 | Sol (Codex acct 2, R3-M1M3) | — | unverified Foundation race behavior not proved | Diagnostic callback races closed FileHandle [tooling/scripts/core-helper/CoreManager.swift:254] |
| MAIN-STALE-CORE-EMERGENCY | M1 | Sol (Codex acct 2, R3-M1M3) | P2 | duplicate #763 | Core constructor error aborts emergency release [tooling/scripts/core-helper/main.swift:805] |
| MAC-APP-FAILURE-AI-HOLD | M1/caller | Sol (Codex acct 2, R3-M1M3) | P1 | real-unfixed outside assigned App ownership; needs separate automatic-release wire intent | Automatic exhausted failure invokes explicit disarm removing AI hold [apps/macos/Tono/Services/AppState+Connect.swift:2259] |

### R3-RegMac (finished 22:47 MT; 145 hypotheses, 90 FP, PRs: #1039 #1043)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| REG-774 | macOS proxy | Sol (Codex acct 2, R3-RegMac) | — | ok | Bounded proxy commands and guard coalescing retain prior cleanup paths. [apps/macos/Tono/Core/SystemProxy.swift:403] |
| REG-788 | macOS sidecar | Sol (Codex acct 2, R3-RegMac) | — | ok | Reused unrelated PID is discarded; unreadable identity and owned-stop failure still refuse. [apps/macos/Tono/Services/TonoSidecarService.swift:312] |
| REG-799 | macOS WebSocket | Sol (Codex acct 2, R3-RegMac) | — | ok | Receive failures mark observer stale before reconnect; callbacks never change protection. [apps/macos/Tono/Core/CoreWebSocket.swift:99] |
| REG-836 | macOS DNS | Sol (Codex acct 2, R3-RegMac) | — | ok | Unreadable resolver files no longer discard known dynamic-store split DNS. [apps/macos/Tono/Core/SystemProxy.swift:587] |
| REG-1027 | macOS WebSocket | Sol (Codex acct 2, R3-RegMac) | — | ok | Quiet logs no longer require unsupported Pong; traffic/connections and error recovery retained. [apps/macos/Tono/Core/CoreWebSocket.swift:358] |
| REG-778 | macOS optional policy | Sol (Codex acct 2, R3-RegMac) | — | ok | Pre-sync optional policy errors restore original session PF; replacement marker precedes sync [apps/macos/Tono/Services/AppState.swift:1991] |
| REG-781 | macOS catalog | Sol (Codex acct 2, R3-RegMac) | — | ok | Home node dial identity now contributes to reload decision; nil/default handling composes with #802 [apps/macos/Tono/Services/AppState+Catalog.swift:229] |
| REG-782 | macOS pin refresh | Sol (Codex acct 2, R3-RegMac) | — | ok | Unstructured bounded utun wait shields postcommit PF convergence from cancellation; disconnect drains task [apps/macos/Tono/Services/AppState+Proxy.swift:563] |
| REG-797 | macOS managed DIRECT | Sol (Codex acct 2, R3-RegMac) | — | ok | Combined assistant protected suffixes preserve parent/child DIRECT exclusion; #867 separately addresses process rules [apps/macos/Tono/Core/Configuration/ConfigPipeline+Direct.swift:30] |
| REG-802 | macOS catalog switch | Sol (Codex acct 2, R3-RegMac) | P2 | concern: in-flight target removal overlaps pending #963 but needs app-level race proof | Target rotation queues latest runtime rewrite; target disappearance can instead commit removed B then rewrite nil selection [apps/macos/Tono/Services/AppState+Catalog.swift:125] |
| REG-835 | macOS uplink | Sol (Codex acct 2, R3-RegMac) | — | ok | Link-local gateway normalized as DHCP gap; concrete service/interface/gateway moves still detected [apps/macos/Tono/Services/NetworkUplinkSnapshot.swift:183] |
| REG-882 | macOS TUN wait | Sol (Codex acct 2, R3-RegMac) | — | ok | Cancellation checked after final poll sleep; #782 unstructured wait deliberately remains uncancelled [apps/macos/Tono/Services/AppState.swift:2291] |
| REG-891 | macOS update monitor | Sol (Codex acct 2, R3-RegMac) | — | ok | Missing-TUN monitor cannot release pending update; explicit Restore still allowed; exhausted helper preserves barrier guard [apps/macos/Tono/Services/AppState+Connect.swift:720] |
| REG-950 | macOS pin refresh | Sol (Codex acct 2, R3-RegMac) | P1 | regression-fixed #1039 | Successful sync followed by readiness failure skips exact PF convergence and blocks ordinary DIRECT traffic. [apps/macos/Tono/Services/AppState+Proxy.swift:519] |
| REG-794 | macOS helper upgrade | Sol (Codex acct 2, R3-RegMac) | P1 | concern: automatic release shares explicit disarm disposition; requires helper intent contract and legacy compatibility | Abandoned helper upgrade automatically performs full disarm and loses AI hold [apps/macos/Tono/Core/HelperManager.swift:259] |
| REG-796 | macOS session auth | Sol (Codex acct 2, R3-RegMac) | — | ok | Superseded bearer refusal reuses current renewal; credential generation fences account replacement [apps/macos/Tono/Services/TonoAPIClient.swift:564] |
| REG-840 | macOS launch recovery | Sol (Codex acct 2, R3-RegMac) | — | ok | Read timeout enters bounded existing repair; root install/update guards remain intact [apps/macos/Tono/Core/RuntimeCleanup.swift:248] |
| REG-854 | macOS initial persistence | Sol (Codex acct 2, R3-RegMac) | — | ok | Initial snapshot application is claimed before await; every scene joins one task [apps/macos/Tono/Services/AppState+Persistence.swift:12] |
| REG-885 | macOS health monitor | Sol (Codex acct 2, R3-RegMac) | — | ok | Healthy probe clears only owned notice; probe seam preserves production implementation [apps/macos/Tono/Services/AppState+Connect.swift:1797] |
| REG-991 | macOS update suspension | Sol (Codex acct 2, R3-RegMac) | — | ok | Cancelled reload completion fenced then drained before slot retirement; pending update blocks competing teardown [apps/macos/Tono/Services/AppState+NativeUpdate.swift:44] |
| REG-993 | macOS update download | Sol (Codex acct 2, R3-RegMac) | — | ok | Whole-resource timer bounds drip metadata; package and verification behavior untouched [apps/macos/Tono/Services/NativeUpdateDownload.swift:27] |
| REG-1008 | macOS credential persistence | Sol (Codex acct 2, R3-RegMac) | — | ok | Credential retry composes with #796 and termination waits after existing network cleanup under 20s bound [apps/macos/Tono/Services/TonoAPIClient.swift:555] |
| REG-804 | macOS node region UI | Sol (Codex acct 2, R3-RegMac) | — | ok | Optional first city avoids empty split trap and leaves unknown geography nil [apps/macos/Tono/Views/NodeCardView.swift:33] |
| REG-818 | macOS rule parsing | Sol (Codex acct 2, R3-RegMac) | — | ok | Remaining component guard follows no-resolve removal; valid MATCH and non-MATCH imports remain admitted [apps/macos/Tono/Models/RuleEntry.swift:98] |
| REG-826 | macOS diagnostic log upload | Sol (Codex acct 2, R3-RegMac) | — | ok | Empty owned chunk advances only local cursor and never uploads foreign records; backup continuation retained [apps/macos/Tono/Services/DiagnosticsLogUploader.swift:499] |
| REG-857 | macOS parser property tests | Sol (Codex acct 2, R3-RegMac) | — | ok | Bounded deterministic tests only; no macOS production parser or network behavior change [apps/macos/TonoTests/ParserPropertyTests.swift:5] |
| MAC-PINS-SYNC-READINESS | macOS pin refresh | Sol (Codex acct 2, R3-RegMac) | P1 | real-fixed #1039 | Use the helper replacement receipt, owned tunnel and exact PF re-arm before advisory readiness. [apps/macos/Tono/Services/AppState+Proxy.swift:519] |
| REG-720 | macOS recovery owner | Sol (Codex acct 2, R3-RegMac) | P1 | regression-fixed #1043 | Unarmed retry survives user Restore and late proof/status can reconnect and re-arm. [apps/macos/Tono/Services/Connection/ConnectionCoordinator.swift:161] |
| MAC-UNARMED-RETRY-RELEASE-OWNER | macOS recovery owner | Sol (Codex acct 2, R3-RegMac) | P1 | real-fixed #1043 | Cancel unarmed owner and fence late TCP/status completions after explicit release. [apps/macos/Tono/Services/AppState+Connect.swift:2266] |
| REG-760 | macOS health release | Sol (Codex acct 2, R3-RegMac) | — | concern: known automatic release AI gap overlaps #1031/#1028 decision records; no new finding | Helper release latch reconciles and Browser Secure DNS conflict releases promptly; automatic disarm AI gap already recorded [apps/macos/Tono/Services/AppState+Connect.swift:1607] |
| REG-744 | macOS sing-box runtime | Sol (Codex acct 2, R3-RegMac) | — | ok | Chrome fingerprint restriction, bounded fake-IP pool and sequential DoH compose with authoritative TUN verification [apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:162] |
| REG-749 | macOS HY2 runtime | Sol (Codex acct 2, R3-RegMac) | — | ok | Supported HY2 QUIC keepalive preserves certificate checks and routes; idle support text annotates diagnostics only [apps/macos/Tono/Core/Configuration/ConfigPipeline+SingBoxProduct.swift:122] |
| REG-741 | macOS legacy DNS emitter | Sol (Codex acct 2, R3-RegMac) | — | ok | Mihomo TTL/H3/cache settings preserve encrypted resolver routing; production sing-box changes owned by #744 [apps/macos/Tono/Core/Configuration/ConfigPipeline+Runtime.swift:143] |
| REG-722 | macOS connect telemetry | Sol (Codex acct 2, R3-RegMac) | — | ok | Shared wire keys augment diagnostic stage fields while old telemetry keys remain unchanged [apps/macos/Tono/Models/ConnectionState.swift:34] |
| REG-720-DIAL | macOS unarmed recovery | Sol (Codex acct 2, R3-RegMac) | P2 | concern: omitted ExitHeal dial wiring requires app-level regression proof; report only | Proof of remembered alternate B is followed by connect using selected A; remembered dial is never published [apps/macos/Tono/Services/AppState+Connect.swift:2307] |
| REG-759 | macOS helper upgrade | Sol (Codex acct 2, R3-RegMac) | - | ok | Never-delivered requests skip version polling; lost replies retain it. #794 release-contract concern remains separately. [apps/macos/Tono/Core/HelperManager.swift:1199] |
| REG-756 | macOS launch DNS recovery | Sol (Codex acct 2, R3-RegMac) | - | ok | Repaired helper always restores DNS; helper sweep preserves non-loopback settings and selective AI layer. [apps/macos/Tono/Core/RuntimeCleanup.swift:438] |
| REG-762 | macOS core log stream | Sol (Codex acct 2, R3-RegMac) | - | ok | Runtime log restart cancels old buffer/receive, retains disabled state, and composes with #1027 quiet-log fix. [apps/macos/Tono/Core/CoreWebSocket.swift:231] |
| REG-719 | macOS traffic summary | Sol (Codex acct 2, R3-RegMac) | - | ok | Session summary reads core totals; callers/tests updated; no network or accounting mutation. [apps/macos/Tono/Views/DataUsageSummaryView.swift:58] |
| REG-721 | macOS sign-in support hint | Sol (Codex acct 2, R3-RegMac) | - | ok | Removing Finder action preserves copy-details, challenge timers, resend and authentication flow. [apps/macos/Tono/Views/AccountGateSupport.swift:158] |
| REG-717 | macOS welcome intro | Sol (Codex acct 2, R3-RegMac) | - | ok | Single-screen intro preserves account/protection gate; both completion actions only set introSeen. [apps/macos/Tono/Views/WelcomeIntroView.swift:29] |
| REG-738 | macOS helper | Sol (Codex acct 2, R3-RegMac) | — | ok | Fixed AI suffix/prefix installer uses bounded exact commands and does not mutate broad PF/default routes. [tooling/scripts/core-helper/SelectiveFailOpen.swift:155] |
| REG-761 | macOS helper | Sol (Codex acct 2, R3-RegMac) | — | ok | Failed placeholder cannot block release/reload stale rules; repair signal survives load errors. [tooling/scripts/core-helper/KillSwitchManager.swift:681] |
| REG-765 | macOS helper | Sol (Codex acct 2, R3-RegMac) | — | ok | DNS snapshot cap matches restore/write limits; foreign authoritative reads remain uncapped. [tooling/scripts/core-helper/ProtectedDNSManager.swift:147] |
| REG-773 | macOS helper | Sol (Codex acct 2, R3-RegMac) | P1 | duplicate of #1028 (merged; omission fixed) | Orphan bootstrap release restores internet but omits selective AI hold. [tooling/scripts/core-helper/SocketServer.swift:328] |
| REG-889 | macOS helper | Sol (Codex acct 2, R3-RegMac) | P1 | duplicate of #1028 (merged; omission fixed) | Failed accepted-barrier release omits selective AI hold. [tooling/scripts/core-helper/KillSwitchManager.swift:557] |
| REG-971 | macOS helper | Sol (Codex acct 2, R3-RegMac) | — | ok | Update recovery releases broad PF, restores DNS and applies the narrow AI hold. [tooling/scripts/core-helper/UpdateExecutor.swift:78] |
| REG-1030 | macOS helper | Sol (Codex acct 2, R3-RegMac) | — | ok | Nonblocking DNS preferences lock retains snapshot and helper/watchdog responsiveness. [tooling/scripts/core-helper/ProtectedDNSManager.swift:984] |
| HYP-DUP-WAKE | macOS update | Sol (Codex acct 2, R3-RegMac) | P2 | duplicate #1001 | Wake owner survives update retirement [apps/macos/Tono/Services/AppState+NativeUpdate.swift:36] |
| HYP-DUP-RETIRE | macOS update | Sol (Codex acct 2, R3-RegMac) | P3 | duplicate #785 | Failed update receipt retirement hides verified release [apps/macos/Tono/Services/AppState+NativeUpdate.swift:132] |
| REG-889-CAVEAT | macOS PF | Sol (Codex acct 2, R3-RegMac) | — | concern: pre-existing documented boundary; no native reproduction | Nonzero PF load status theoretically could follow partial kernel commit [tooling/scripts/core-helper/KillSwitchManager.swift:557] |
| REG-1033 | macOS helper DNS restore/handoff | Sol (Codex acct 2, R3-RegMac) | - | ok | Saved-original equality retries production writer/Commit/Apply before retiring recovery; cap, external ownership, contention and tests retained. [tooling/scripts/core-helper/ProtectedDNSManager.swift:321] |
| REG-1039 | macOS pin refresh | Sol (Codex acct 2, R3-RegMac) | — | ok; merged #1039 | Own follow-up: independent reviews and exact-head native CI verify pins-only convergence before advisory readiness. [apps/macos/Tono/Services/AppState+Proxy.swift:540] |
| REG-1043 | macOS recovery owner | Sol (Codex acct 2, R3-RegMac) | — | ok; merged #1043 | Own follow-up independently reviewed and exact-head native CI proves retry ownership fix. [apps/macos/Tono/Services/Connection/ConnectionCoordinator.swift:161] |
| REG-1028 | macOS helper AI recovery | Sol (Codex acct 2, R3-RegMac) | — | ok | Automatic failed-barrier and orphan release keep AI hold; DNS/update composition and contract remain correct. [tooling/scripts/core-helper/KillSwitchManager.swift:636] |

### R3-W9inst (finished 22:47 MT; 18 hypotheses, 11 FP, PRs: #1042)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| WIN-UPDATE-ROLLBACK-UNVERIFIED-HOLD | W9 | Sol (Codex acct 2, R3-W9inst) | P1 | real-fixed #1042 (merged 6b2be353; ci-gate SUCCESS) | Native publication rollback restarts predecessor but leaves unverified update barrier indefinitely [apps/windows/service/src/bin/install_service/update_executor.rs:521] |
| W9-DUP-SCM-RECOVERY | W9 | Sol (Codex acct 2, R3-W9inst) | P2 | duplicate BRICK-W9 known open finding | SCM recovery configuration failure bypasses restart/fallback [apps/windows/service/src/bin/install_service/update_executor.rs:558] |
| W9-DEFERRED-PARTIAL-STAGE | W9 | Sol (Codex acct 2, R3-W9inst) | P2 | real-unfixed prior deferred target lock plus independent later staging I/O failure; lower priority no native reproduction | Later failed repair can replace queued reboot candidate with incomplete staging [apps/windows/service/src/bin/install_service.rs:81] |
| W9-DUP-SERVICEONLY-ROLLBACK | W9 | Sol (Codex acct 2, R3-W9inst) | P2 | duplicate issue815 known unconfirmed design gap | Service-only repair has no predecessor backup after readiness failure [apps/windows/service/src/bin/install_service.rs:2071] |
| W9-DUP-RECOVERY-TASK | W9 | Sol (Codex acct 2, R3-W9inst) | P2 | duplicate X3-2-order issue488 | Task Scheduler failure before publication leaves pending rollback [apps/windows/service/src/bin/install_service/update_executor.rs:415] |
| W9-RESOURCE-CANCEL-REPAIR | W9 | Sol (Codex acct 2, R3-W9inst) | P2 | real-unfixed multistep upgrade failure/cancel/repair; lower priority native verification pending | Cancel a later retry wizard then App repair can use newer resources against rolled-back old core [apps/windows/app/src-tauri/packages/windows/installer.nsi:1461] |
| W9-TARGET-PUBLICATION-CLOCK | W9 | Sol (Codex acct 2, R3-W9inst) | P2 | unconfirmed interruption plus old mapped image window; no ordinary impact proved | Complete-target early recovery can omit publication floor [apps/windows/service/src/bin/install_service/update_executor.rs:375] |

### R3-P1mac (finished 22:58 MT; 6 hypotheses, 4 FP, PRs: #1048)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| MAC-APP-FAILURE-AI-HOLD | macOS app/helper | Sol (Codex acct 2, R3-P1mac) | P1 | real-fixed #1048 merged; ci-gate green; needs-hardware | Exhausted automatic failure uses explicit disarm and deletes AI hold [apps/macos/Tono/Services/AppState+Connect.swift:2259] |
| MAC-DASHSCOPE-DIRECT-COVERAGE | macOS/shared policy | Sol (Codex acct 2, R3-P1mac) | P1 | real-unfixed coordinated policy migration and recovery helper edits required; helper edits forbidden for this finding | Dedicated model API hosts match Alibaba DIRECT suffix and lack recovery hold [apps/macos/Tono/Core/ConfigPipeline.swift:114] |

### R3-P1win (finished 22:58 MT; 6 hypotheses, 3 FP, PRs: #1046)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | Windows automatic DIRECT recovery | Sol (Codex acct 2, R3-P1win) | P1 | real-unfixed decision required; recorded #1046: existing release opens WFP before best-effort AI hold | Automatic release never cancels the stalled DIRECT reader [apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397] |
| WIN-REPLACEMENT-HEAL-STATE | Windows replacement account | Sol (Codex acct 2, R3-P1win) | P2 | duplicate of #1047; independent exact-source regression failed before and passed after; own implementation dropped | Replacement sign-in retains previous account fallback and recovery history [apps/windows/app/src-tauri/src/tono/commands/account.rs:359] |
| WIN-UPDATE-CONNECTING-CLEANUP | Windows update recovery | Sol (Codex acct 2, R3-P1win) | P2 | real-unfixed same AI-preserving release blocker as P1; recorded #1046; earlier release violates top rule | Failed Prepare during Connecting omits immediate generation-owned recovery [apps/windows/app/src-tauri/src/tono/commands/update.rs:277] |

### R3-A5A6 (finished 23:10 MT; 32 hypotheses, 17 FP, PRs: #1036 #1038 #1045 #1047)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| WIN-CATALOG-VANISH-AI-HOLD | A5/catalog sync | Sol (Codex acct 2, R3-A5A6) | P1 | real-fixed #1036 | Automatic vanished-exit release removes the secondary AI hold [apps/windows/app/src-tauri/src/tono/connection/switch.rs:62] |
| WIN-REPLACEMENT-HEAL-STATE | A5 | Sol (Codex acct 2, R3-A5A6) | P2 | real-fixed #1047 | Replacement sign-in retains previous account healer dial state [apps/windows/app/src-tauri/src/tono/commands/account.rs:359] |
| WIN-GRANT-FLUSH-QUEUE | A5 | Sol (Codex acct 2, R3-A5A6) | P2 | real-unfixed P2 prolonged vault stall; rejected token rotation can outlast recovery | Timed-out grant flushes fill vault queue after a prolonged stall [apps/windows/app/src-tauri/src/tono/offline_grant.rs:512] |
| R3-A5-CONNECTING-ROUTING | A5 | Sol (Codex acct 2, R3-A5A6) | P2 | duplicate known #787 limitation | Residential catalog rotation during Connecting leaves stale runtime [apps/windows/app/src-tauri/src/tono/catalog_sync.rs:346] |
| WIN-IDLE-QUIT-IPC-DELAY | A6 | Sol (Codex acct 2, R3-A5A6) | P1 | real-fixed #1038 | Optional idle-Service shutdown can silently delay Quit up to 127 seconds [apps/windows/app/src-tauri/src/feat/window.rs:538] |
| WIN-STARTUP-AUTH-SUPERSESSION | A6 | Sol (Codex acct 2, R3-A5A6) | P2 | real-fixed #1045 | Boot preflight can supersede a newer interactive sign-in [apps/windows/app/src-tauri/src/tono/commands/restore.rs:128] |
| R3-A6-PROXY-SINGLETON | A6 | Sol (Codex acct 2, R3-A5A6) | P3 | duplicate #984 | Singleton notify inherits proxy [apps/windows/app/src-tauri/src/utils/server.rs:100] |
| WIN-FAILED-PREPARE-AI-HOLD | A6 | Sol (Codex acct 2, R3-A5A6) | P1 | duplicate #1040; independently reproduced, own alternate branch not submitted | Automatic failed-Prepare release discards narrow intent through pending-update Disconnect [apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:267] |
| R3-A6-ADOPT-INCOMPLETE | A6 | Sol (Codex acct 2, R3-A5A6) | P2 | duplicate BRICK-W10 | Failed Adopt latches INCOMPLETE [apps/windows/app/src-tauri/src/tono/commands/update.rs:346] |
| R3-A6-MANUAL-LEASE | A6 | Sol (Codex acct 2, R3-A5A6) | P2 | duplicate BRICK-W2/BRICK-W5 | Manual lease refuses pending update release [apps/windows/app/src-tauri/src/tono/commands/update.rs:364] |
| R3-A6-SPAWN-FAIL | A6 | Sol (Codex acct 2, R3-A5A6) | P1 | duplicate fixed #961 | Executor spawn failure retains bootstrap block [apps/windows/app/src-tauri/src/tono/commands/update.rs:208] |
| R3-A6-PREPARE-STOP | A6 | Sol (Codex acct 2, R3-A5A6) | P1 | duplicate fixed #793 | Prepare error after Core stop retains block [apps/windows/app/src-tauri/src/tono/commands/update.rs:195] |
| R3-A6-QUIT-POLLING | A6 | Sol (Codex acct 2, R3-A5A6) | P2 | duplicate fixed #784 | Cancelled Quit loses catalog sync [apps/windows/app/src-tauri/src/tono/commands/quit.rs:452] |
| WIN-UPDATE-CONNECTING-CLEANUP | A6 | Sol (Codex acct 2, R3-A5A6) | P2 | real-unfixed P2 ordinary operation overlap; watchdog caps recovery at seven minutes | Failed update while Connecting omits immediate recovery [apps/windows/app/src-tauri/src/tono/commands/update.rs:277] |
| WIN-UPDATE-TOKEN-FLUSH | A6 | Sol (Codex acct 2, R3-A5A6) | P2 | real-unfixed P2 two failures (vault write and update publication); late reopen beyond replay grace | Executor hard termination bypasses failed rotated-token exit flush [apps/windows/app/src-tauri/src/tono/commands/update.rs:202] |

### R3-RegWin (finished 23:21 MT; 147 hypotheses, 27 FP, PRs: #1037 #1040 #1044)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| REG-791 | Windows catalog release | Sol (Codex acct 2, R3-RegWin) | P1 | concern: duplicate of #1036 | Automatic catalog removal uses plain release and removes AI hold [apps/windows/app/src-tauri/src/tono/connection/switch.rs:62] |
| R3REGW-CATALOG-AI-HOLD | Windows catalog release | Sol (Codex acct 2, R3-RegWin) | P1 | duplicate of #1036; dropped local implementation | Automatic catalog removal removes secondary AI hold [apps/windows/app/src-tauri/src/tono/connection/switch.rs:62] |
| REG-990 | Windows account | Sol (Codex acct 2, R3-RegWin) | — | ok: obsolete 401 suppressed only after committed different bearer; current refusals retained; auth suite 59 passed | Merged regression review [apps/windows/crates/tono-core/src/auth.rs:1605] |
| REG-916 | Windows audit upload | Sol (Codex acct 2, R3-RegWin) | — | ok: upload-scope filter and immutable receipt bytes retained; raw consumption cursor separate from redaction | Merged regression review [apps/windows/app/src-tauri/src/tono/log_upload.rs:196] |
| REG-843 | Windows credentials | Sol (Codex acct 2, R3-RegWin) | — | ok: failed latest key mutation retried serially; later write/delete supersedes failure | Merged regression review [apps/windows/app/src-tauri/src/tono/credentials.rs:766] |
| REG-980 | Windows exit credentials | Sol (Codex acct 2, R3-RegWin) | — | ok: audit and vault flush share bounded exit budget without closing cancelled-quit path | Merged regression review [apps/windows/app/src-tauri/src/tono/commands/quit.rs:400] |
| REG-837 | Windows frontend CI | Sol (Codex acct 2, R3-RegWin) | — | ok: additive strict-index ratchet; normal typecheck retained | Merged regression review [apps/windows/app/package.json:37] |
| REG-834 | Windows WebSocket IPC | Sol (Codex acct 2, R3-RegWin) | — | ok: full decimal string crosses command and JS boundary; Rust internal u128 preserved | Merged regression review [apps/windows/crates/tono-plugin-core/src/commands.rs:265] |
| REG-807 | Windows WebSocket handshake | Sol (Codex acct 2, R3-RegWin) | — | ok: timeout bounds handshake only; no filter/state mutation | Merged regression review [apps/windows/crates/tono-plugin-core/src/mihomo.rs:387] |
| REG-768 | Windows WebSocket recovery | Sol (Codex acct 2, R3-RegWin) | — | ok: connect watchdog cleared after transport completion; initialization rejection now closes and reconnects | Merged regression review [apps/windows/app/src/hooks/use-mihomo-ws-subscription.ts:161] |
| R3REGW-FRESH-ARM-READBACK | Windows Service proof | Sol (Codex acct 2, R3-RegWin) | P1 | real-fixed #1037 | Inherited verification acknowledges an undelivered MarkVerified and leaves fresh deadline active [apps/windows/service/src/core/windows_kill_switch.rs:4074] |
| REG-1021 | Windows Service proof | Sol (Codex acct 2, R3-RegWin) | P1 | regression-fixed #1037 | Fresh deadline combines with inherited verified readback to retire healthy reconnect [apps/windows/service/src/core/windows_kill_switch.rs:4045] |
| REG-1010 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | guard transfer uses narrow release [apps/windows/app/src-tauri/src/tono/connection.rs:681] |
| REG-1005 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | unverified retirement narrow/strict branches retained [apps/windows/service/src/core/windows_kill_switch.rs:3518] |
| REG-1003 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | automatic health cleanup preserves AI hold [apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1309] |
| REG-945 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | hot-switch probe results scoped to node owner [apps/windows/app/src-tauri/src/tono/commands/catalog.rs:280] |
| REG-942 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | stale status publication generation rejected [apps/windows/app/src-tauri/src/tono/connection/monitor.rs:136] |
| REG-917 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | runtime TUN proof aligns owned producer [apps/windows/service/src/core/runtime_generation/owned_config.rs:97] |
| REG-900 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | only inactive DIRECT metadata resets [apps/windows/app/src-tauri/src/tono/connection.rs:308] |
| REG-898 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | controller wait cancellation preserves Service mutation owner [apps/windows/app/src-tauri/src/tono/connection/direct.rs:796] |
| REG-884 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | Core/browser-DNS time included in budget [apps/windows/app/src-tauri/src/tono/connection/transaction.rs:34] |
| REG-879 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | down hardware NIC filtered from optional DIRECT bind [apps/windows/app/src-tauri/src/tono/connection/platform.rs:213] |
| REG-878 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | debounce defers baseline while preserving later invalidation [apps/windows/app/src-tauri/src/tono/connection_health.rs:161] |
| REG-874 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | previous-account failover state resets on finalization [apps/windows/app/src-tauri/src/tono/commands/account.rs:621] |
| REG-871 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | assistant shield producer and consumer agree [apps/windows/app/src-tauri/src/tono/connection/direct.rs:973] |
| REG-797 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | DIRECT assistant suffix rejection retained [apps/windows/crates/tono-core/src/policy.rs:301] |
| REG-787 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | routing rebuild and lifecycle cleanup compose; known Connecting limitation [apps/windows/app/src-tauri/src/tono/catalog_sync.rs:197] |
| REG-786 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | equal routing revisions renew; empty graph skips reload [apps/windows/app/src-tauri/src/tono/connection/direct.rs:205] |
| REG-784 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | owned pre-discovery protection release and cancelled sync revival [apps/windows/app/src-tauri/src/tono/commands/quit.rs:40] |
| REG-772 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | only first certain update adoption permits reconnect [apps/windows/app/src-tauri/src/tono/commands/update.rs:312] |
| REG-771 | Windows app | Sol (Codex acct 2, R3-RegWin) | — | ok | empty ASCII fold no longer equates Unicode names [apps/windows/app/src-tauri/src/tono/catalog_sync.rs:518] |
| REG-1025 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | prior committed scratch cleaned only after member proof [apps/windows/service/src/core/update.rs:355] |
| REG-1017 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | cleanup failure retains recovery task [apps/windows/service/src/bin/install_service/update_executor.rs:737] |
| REG-1007 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | post-stop failed Prepare requests AI hold [apps/windows/service/src/core/update.rs:325] |
| REG-989 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | restore-only whitespace parser preserves saved registry bytes [apps/windows/service/src/core/dns/mod.rs:550] |
| REG-988 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | native timeouts retain ordered worker ownership [apps/windows/service/src/core/selective_layer.rs:45] |
| REG-987 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | new adapter DoH originals durable before mutation [apps/windows/service/src/core/dns/engine.rs:528] |
| REG-985 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | locked restored captures retained with retirement marker [apps/windows/service/src/core/dns/engine.rs:412] |
| REG-978 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | restart recovery preserves strict and narrow guards [apps/windows/service/src/bin/install_service/update_executor.rs:578] |
| REG-961 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | executor never spawned releases non-strict with AI hold [apps/windows/service/src/core/update.rs:595] |
| REG-923 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | quarantined helper settles UI without opening operation admission [apps/windows/app/src-tauri/src/core/runstate/mod.rs:192] |
| REG-925 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | proxy clear waiter registers wakeup then runs own clear [apps/windows/app/src-tauri/src/core/sysopt.rs:151] |
| REG-868 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | IPv4 CIM84 still reaches IPv6 [apps/windows/service/src/core/dns/engine.rs:1047] |
| REG-858 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | exact successor resumes once; narrow/strict fallback retained [apps/windows/service/src/core/update/security.rs:702] |
| REG-844 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | update proof cannot heal DNS behind wanted WFP [apps/windows/service/src/core/dns/mod.rs:3214] |
| REG-841 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | blocking writer retains DNS self-write guard [apps/windows/service/src/core/dns/mod.rs:501] |
| REG-828 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | callback owns completion through notify [apps/windows/app/src-tauri/src/tono/windows_dns.rs:52] |
| REG-824 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | task operations use OS system directory [apps/windows/service/src/core/update.rs:1110] |
| REG-801 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | verified candidates survive rollback; Service restaged on retry [apps/windows/service/src/bin/install_service.rs:1499] |
| REG-776 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | abandoned runtime drop avoids native-call hang [apps/windows/service/src/bin/shared/mod.rs:38] |
| REG-769 | Windows DNS/update | Sol (Codex acct 2, R3-RegWin) | — | ok | delete-only restore path safe; earlier rewrite gap duplicate #982 [apps/windows/service/src/core/dns/mod.rs:2852] |
| REG-1024 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | pending crash retry cancelled after release [apps/windows/service/src/core/windows_kill_switch.rs:2785] |
| REG-1022 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | takeover verifies same owned process handle [apps/windows/service/src/core/owner.rs:111] |
| REG-1014 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | automatic stop retains armed non-strict AI hold [apps/windows/service/src/core/windows_kill_switch.rs:2991] |
| REG-1012 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | timeout termination pins Core creation identity [apps/windows/service/src/core/manager.rs:1147] |
| REG-1004 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | SCM/image/creation checks precede escalation [apps/windows/service/src/bin/shared/mod.rs:205] |
| REG-999 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | confirmed dead Core PID retired before cleanup awaits [apps/windows/service/src/core/manager.rs:854] |
| REG-994 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | orphan termination checks path and creation identity [apps/windows/service/src/core/process.rs:290] |
| REG-986 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | unwanted-intent retries preserve reconnect evidence [apps/windows/service/src/core/windows_kill_switch.rs:555] |
| REG-983 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | selective release retry preserves narrow intent [apps/windows/app/src-tauri/src/core/service/mod.rs:1339] |
| REG-976 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | AI hold removed only after exact WFP install succeeds [apps/windows/service/src/core/windows_kill_switch.rs:1301] |
| REG-974 | Windows Service | Sol (Codex acct 2, R3-RegWin) | P2 | regression-fixed #1044 | Committed DIRECT expiry deletes its newly-installed AI hold through a redundant second apply [apps/windows/service/src/core/windows_kill_switch.rs:3121] |
| REG-955 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | shutdown reserved under lifecycle ownership [apps/windows/service/src/core/server/handlers.rs:1041] |
| REG-933 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | SCM native-thread slots survive waiter timeout [apps/windows/service/src/client/mod.rs:172] |
| REG-929 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | log read has no owner-recovery mutation [apps/windows/app/src-tauri/src/core/service/mod.rs:281] |
| REG-912 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | bounded SCM reads refuse late concurrent repair [apps/windows/app/src-tauri/src/core/service/mod.rs:554] |
| REG-911 | Windows Service | Sol (Codex acct 2, R3-RegWin) | P2 | concern: real-unfixed P2; interrupted publication plus prepublication mapped peer; native exposure unverified | Complete-publication recovery returns before missing publication floor is recorded [apps/windows/service/src/bin/install_service/update_executor.rs:376] |
| REG-902 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | SCM stop hint refresher exits and joins bounded [apps/windows/service/src/bin/service.rs:422] |
| REG-873 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | record absence still stops supervised Core [apps/windows/service/src/core/server/mod.rs:362] |
| REG-866 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | unconfirmed stop reinstalls protected DNS [apps/windows/service/src/core/server/mod.rs:339] |
| REG-812 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | poisoned ARMED lock uses recovery accessor [apps/windows/service/src/core/windows_kill_switch.rs:1992] |
| REG-792 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | stop release strict/narrow and DNS guards retained [apps/windows/service/src/core/server/mod.rs:561] |
| REG-775 | Windows Service | Sol (Codex acct 2, R3-RegWin) | — | ok | corrupt record quarantine follows orphan proof [apps/windows/service/src/core/runtime.rs:79] |
| REG-779 | Windows update cleanup | Sol (Codex acct 2, R3-RegWin) | P1 | regression-fixed #1040 | Automatic failed-Prepare update Disconnect drops narrow intent [apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:275] |
| REG-793 | Windows update cleanup | Sol (Codex acct 2, R3-RegWin) | P1 | regression-fixed #1040 | Early staging error bypasses post-stop AI cleanup and App pending route uses plain release [apps/windows/service/src/core/update.rs:670] |
| REG-777 | Windows DIRECT expiry | Sol (Codex acct 2, R3-RegWin) | P2 | regression-fixed #1044 | Committed DIRECT expiry deletes its newly-installed AI hold through a redundant second apply [apps/windows/service/src/core/windows_kill_switch.rs:3664] |
| R3REGW-DIRECT-DOUBLE-HOLD | Windows DIRECT expiry | Sol (Codex acct 2, R3-RegWin) | P2 | real-fixed #1044 | Committed DIRECT expiry deletes its newly-installed AI hold through a redundant second apply [apps/windows/service/src/core/windows_kill_switch.rs:3664] |
| REG-951 | Windows Activity | Sol (Codex acct 2, R3-RegWin) | — | ok | Object.hasOwn admits only declared string process families [apps/windows/app/src/pages/tono/activity-model.ts:129] |
| REG-932 | Windows account UI | Sol (Codex acct 2, R3-RegWin) | — | ok | account/device cache uses current process and sign-in generation; nil scope disables fetch [apps/windows/app/src/tono-ui/TonoAccountCard.tsx:54] |
| REG-984 | Windows singleton | Sol (Codex acct 2, R3-RegWin) | — | ok | authenticated loopback notification bypasses inherited external proxies [apps/windows/app/src-tauri/src/utils/server.rs:100] |
| REG-820 | Windows status subscription | Sol (Codex acct 2, R3-RegWin) | — | ok | live listener reused; pending registration/last-owner teardown retained [apps/windows/app/src/services/tono.ts:882] |
| REG-857 | Windows parser tests | Sol (Codex acct 2, R3-RegWin) | — | ok | bounded test additions only; no production parser behavior changes [apps/windows/crates/tono-core/src/node.rs:593] |
| R3REGW-UPDATE-DISCONNECT-AI-HOLD | Windows update cleanup | Sol (Codex acct 2, R3-RegWin) | P1 | real-fixed #1040 | Automatic pending-update release loses AI-hold disposition [apps/windows/service/src/core/update.rs:670] |
| R3REGW-RECOVERY-PUBLICATION-FLOOR | Windows update recovery | Sol (Codex acct 2, R3-RegWin) | P2 | real-unfixed: incomplete #911; narrow interruption plus old mapped peer; no native reproduction; lower priority tonight | Complete-publication recovery bypasses publication-floor fallback [apps/windows/service/src/bin/install_service/update_executor.rs:376] |
| R3REGW-DNS-SNAPSHOT-REWRITE | Windows DNS restore | Sol (Codex acct 2, R3-RegWin) | P1 | duplicate of #982; no competing fix | Locked snapshot refresh can fail before deletion-tolerant restore proof [apps/windows/service/src/core/dns/mod.rs:2771] |
| R3REGW-CATALOG-CONNECTING | Windows catalog routing | Sol (Codex acct 2, R3-RegWin) | — | duplicate of known #787 limitation; deliberately deferred, no change | Residential routing rebuild requires Connected while connect uses captured routing [apps/windows/app/src-tauri/src/tono/catalog_sync.rs:346] |
| REG-1029 | Windows startup retry | Sol (Codex acct 2, R3-RegWin) | — | ok | Ownerless startup retry preserves AI hold, strict intent, successor and Restore disposition [apps/windows/service/src/core/windows_kill_switch.rs:555] |
| REG-1032 | Windows Core exhaustion | Sol (Codex acct 2, R3-RegWin) | — | ok | Epoch-fenced exhaustion retirement preserves AI hold and strict protection [apps/windows/service/src/core/manager.rs:1109] |
| REG-1037 | Windows verification | Sol (Codex acct 2, R3-RegWin) | — | ok | Fresh-arm readback composes with Core exhaustion and update recovery [apps/windows/service/src/core/windows_kill_switch.rs:4074] |
| REG-1036 | Windows catalog release | Sol (Codex acct 2, R3-RegWin) | — | ok | Catalog removal narrow release composes with lifecycle, strict and update fences [apps/windows/app/src-tauri/src/tono/connection/switch.rs:62] |
| REG-1038 | Windows Quit | Sol (Codex acct 2, R3-RegWin) | — | ok | Only optional idle Service shutdown is bounded after required quit cleanup [apps/windows/app/src-tauri/src/feat/window.rs:546] |
| REG-1040 | Windows update cleanup | Sol (Codex acct 2, R3-RegWin) | — | ok | Narrow pending-update operation composes with strict, owner and release fences [apps/windows/service/src/core/update.rs:646] |
| REG-1044 | Windows DIRECT expiry | Sol (Codex acct 2, R3-RegWin) | — | ok | Merged expiry invokes the shared AI hold once; combined WFP111pass [apps/windows/service/src/core/windows_kill_switch.rs:3661] |
| REG-1045 | Windows startup auth | Sol (Codex acct 2, R3-RegWin) | — | ok | Startup reserves initial auth generation before adoption and respects interactive ownership [apps/windows/app/src-tauri/src/tono/commands/restore.rs:110] |
| REG-754 | Windows DNS restore | Sol (Codex acct 2, R3-RegWin) | — | ok | GUID case comparison preserves exact DNS values and live proof [apps/windows/service/src/core/dns/mod.rs:1052] |
| REG-741 | Windows runtime DNS | Sol (Codex acct 2, R3-RegWin) | — | ok | Exit DNS additions retain both DoH resolvers and match Service whitelist [apps/windows/crates/tono-core/src/config.rs:956] |
| REG-749 | Windows HY2 keepalive | Sol (Codex acct 2, R3-RegWin) | — | ok | Keepalive stamps admitted HY2 outbound after certificate gate [apps/windows/crates/tono-core/src/sing_box/runtime.rs:396] |
| REG-1042 | Windows update rollback | Sol (Codex acct 2, R3-RegWin) | P2 | concern: real-unfixed; source-proven, native-unverified; two failures; cutoff passed | Failed publication plus failed restart repeats a successfully-installed AI hold [apps/windows/service/src/bin/install_service/update_executor.rs:622] |
| R3REGW-ROLLBACK-DOUBLE-HOLD | Windows update rollback | Sol (Codex acct 2, R3-RegWin) | P2 | real-unfixed: two independent failures; native gap unverified; no new fixes after22:45 | Second emergency release removes AI hold after rollback already installed it [apps/windows/service/src/bin/install_service/update_executor.rs:622] |
| REG-714 | Windows background reconnect | Sol (Codex acct 2, R3-RegWin) | P1 | concern: real-unfixed P1; exact production loop harness proves no post-failure backoff; cutoff passed | Failed admitted connect resets probe schedule and immediately retries a TCP-open exit [apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:155] |
| R3REGW-UNARMED-CONNECT-BACKOFF | Windows background reconnect | Sol (Codex acct 2, R3-RegWin) | P1 | real-unfixed: production run plus Schedule harness6failures in119.687us; no new fixes after22:45 | Persistent TLS/data-plane failure with reachable TCP repeatedly arms and releases instead of backing off [apps/windows/app/src-tauri/src/tono/connection/unarmed_probe.rs:155] |
| REG-757 | Windows App | Sol (Codex acct 2, R3-RegWin) | — | ok | Signed-path changes prohibit in-place recovery; health cleanup retains AI hold [apps/windows/app/src-tauri/src/tono/connection/monitor.rs:400] |
| REG-715 | Windows health cleanup | Sol (Codex acct 2, R3-RegWin) | — | ok | Health give-up releases narrow while policy-rebuild and strict exclusions remain [apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397] |
| REG-722 | Windows stage wire | Sol (Codex acct 2, R3-RegWin) | — | ok | Shared stage mapping retains all nine Windows strings and timing budgets [apps/windows/crates/tono-core/src/connect_timing.rs:23] |
| REG-735 | Windows account display | Sol (Codex acct 2, R3-RegWin) | — | ok | Plan/expiry/usage additions remain display-only; scoped account fetch preserved [apps/windows/app/src/tono-ui/TonoAccountCard.tsx:226] |
| REG-731 | Windows session display | Sol (Codex acct 2, R3-RegWin) | — | ok | Session total consumes generation-bound live feed; no mutation path [apps/windows/app/src/pages/tono/dashboard.tsx:717] |
| REG-726 | Windows connection copy | Sol (Codex acct 2, R3-RegWin) | — | ok | Connected subtitle remains display-only and preserves skipped DIRECT detail [apps/windows/app/src/pages/tono/dashboard.tsx:695] |
| REG-723 | Windows onboarding hint | Sol (Codex acct 2, R3-RegWin) | — | ok | Checklist removal retains measured DNS hint without altering cleanup actions [apps/windows/app/src/pages/tono/dashboard.tsx:852] |
| REG-717 | Windows intro | Sol (Codex acct 2, R3-RegWin) | — | ok | Single-screen intro preserves persisted seen marker and login navigation [apps/windows/app/src/pages/tono/intro.tsx:20] |
| REG-673 | Windows dependencies | Sol (Codex acct 2, R3-RegWin) | — | ok: dependency-consumer diff review; package internals not exhausted | Manifest and lock update only; applicable frontend/App CI passed [apps/windows/app/package.json:61] |
| REG-670 | Windows plugin build dependencies | Sol (Codex acct 2, R3-RegWin) | — | ok: dependency-consumer diff review; package internals not exhausted | Rollup patch update changes build tooling only; lockfile and CI retained [apps/windows/crates/tono-plugin-core/package.json:29] |
| REG-753 | Windows startup WFP | Sol (Codex acct 2, R3-RegWin) | — | ok | Startup retry is fenced; persistent loopback, DHCP and NDP permit floor retained [apps/windows/service/src/core/windows_kill_switch.rs:555] |
| REG-740 | Windows restored barrier | Sol (Codex acct 2, R3-RegWin) | — | ok | Unproven-Core recovery retains AI hold; strict and explicit release exclusions remain [apps/windows/service/src/core/windows_kill_switch.rs:2965] |
| REG-738 | Windows selective AI hold | Sol (Codex acct 2, R3-RegWin) | P2 | concern: real-unfixed; source-proven alternate-drive omission; native untested; cutoff passed | Hardcoded C-drive netsh loses Claude IP rules on alternate system drives [apps/windows/service/src/core/selective_fail_open.rs:106] |
| R3REGW-SELECTIVE-NETSH-PATH | Windows selective AI hold | Sol (Codex acct 2, R3-RegWin) | P2 | real-unfixed: valid uncommon installation; no system-directory fallback; native untested; cutoff passed | Automatic AI prefix hold invokes nonexistent C-drive netsh on alternate Windows system root [apps/windows/service/src/core/selective_fail_open.rs:106] |
| REG-718 | Windows protected policy reconnect | Sol (Codex acct 2, R3-RegWin) | P2 | concern: real-unfixed; source-proven, native-unverified; healthy VLESS reconnect fails after cache expiry; cutoff passed | Unconditional App TCP proof runs behind retained blocked WFP on policy rebuild [apps/windows/app/src-tauri/src/tono/connection.rs:440] |
| R3REGW-PROTECTED-TCP-PROOF | Windows protected policy reconnect | Sol (Codex acct 2, R3-RegWin) | P2 | real-unfixed: Core-only physical endpoint permit; later failure restores normal internet; native unverified; cutoff passed | Retained protected policy rebuild blocks its own App TCP preflight before Core restart [apps/windows/app/src-tauri/src/tono/connection.rs:440] |
| REG-739 | Windows AI tally | Sol (Codex acct 2, R3-RegWin) | P2/P3 | concern: real-unfixed; actual SWR component and accumulator tests failed; cutoff passed | Unscoped account cache shows prior local tally; flow receipt Map retains historical IDs [apps/windows/app/src/tono-ui/AiTrafficCard.tsx:48] |
| R3REGW-AI-TALLY-ACCOUNT-SCOPE | Windows AI tally | Sol (Codex acct 2, R3-RegWin) | P2 | real-unfixed: real SWR/component test fails under pending replacement local IPC; transient UI data exposure; cutoff passed | Cached prior account loads and displays its local tally after replacement sign-in [apps/windows/app/src/tono-ui/AiTrafficCard.tsx:48] |
| R3REGW-AI-TALLY-SEEN-GROWTH | Windows AI tally | Sol (Codex acct 2, R3-RegWin) | P3 | real-unfixed: actual accumulator retains6000 completed IDs after empty frame; OOM/hang not demonstrated; cutoff passed | Module deduplication retains every historical flow ID until controller generation changes [apps/windows/app/src/tono-ui/AiTrafficCard.tsx:28] |

### R4-Issue1051 (finished 23:36 MT; 3 hypotheses, 0 FP, PRs: )
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | Windows App | Sol (Codex acct 2, R4-Issue1051) | P1 | real-unfixed #1051: no AI-preserving backend without prohibited availability tradeoff; evidence report.md | Automatic health release does not retire stalled DIRECT lifecycle reader [apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1397] |
| WIN-UPDATE-CONNECTING-CLEANUP | Windows App | Sol (Codex acct 2, R4-Issue1051) | P2 | real-unfixed #1051: same AI-preserving release blocker | Failed Prepare folds current armed Connecting without immediate release [apps/windows/app/src-tauri/src/tono/commands/update.rs:277] |
| R4I1051-AI-RELEASE-PROOF | Windows Service | Sol (Codex acct 2, R4-Issue1051) | - | duplicate of #1046 recorded blocker; reverified with paused-worker regression | Narrow request returns without installation proof after WFP removal [apps/windows/service/src/core/selective_layer.rs:61] |

### R4-UpdateInstall (finished 23:36 MT; 76 hypotheses, 26 FP, PRs: #1064 #1075)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| REG-1005 | Windows startup/update combination | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Unverified startup retains AI and strict mode; pending updates intentionally defer retirement [apps/windows/service/src/core/windows_kill_switch.rs:3523] |
| REG-1007 | Windows failed Prepare | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Automatic post-stop cleanup retains AI disposition and durable obligation [apps/windows/service/src/core/update.rs:325] |
| REG-1017 | Windows committed update | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Failed artifact cleanup retains boot task for idempotent retry [apps/windows/service/src/bin/install_service/update_executor.rs:818] |
| REG-1025 | Windows update preparation | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Committed scratch is proved and cleaned before new reservation; refusal preserves retry ownership [apps/windows/service/src/core/update.rs:354] |
| REG-1028 | macOS update combination | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Failed-commit release now installs AI floor; #971 repeats it idempotently [tooling/scripts/core-helper/KillSwitchManager.swift:644] |
| REG-1040 | Windows pending-update cleanup | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Automatic Disconnect retains narrow intent and strict admission [apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:267] |
| REG-1042 | Windows failed update | Sol (Codex acct 2, R4-UpdateInstall) | P1 | regression-fixed #1075; issue #1081 | Rollback-only finalizer misses task refusal and executor error; interrupted replay also omitted [apps/windows/service/src/bin/install_service/update_executor.rs:433] |
| REG-1045 | Windows launch/update adoption | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Initial auth generation fences adoption and interactive sign-in [apps/windows/app/src-tauri/src/tono/commands/restore.rs:109] |
| REG-1048 | macOS install/recovery combination | Sol (Codex acct 2, R4-UpdateInstall) | P2 | concern: abandoned-upgrade unarmed cleanup follow-up is covered by issue #1071; unrelated pre-arm triggers not separately proven | Armed exhaustion retains AI; unarmed pre-arm failure sibling still uses explicit disarm [apps/macos/Tono/Services/AppState+Connect.swift:665] |
| REG-708 | macOS update failure | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Startup/rollback failure releases PF; #971 supplies DNS and AI recovery [tooling/scripts/core-helper/UpdateExecutor.swift:78] |
| REG-712 | macOS update disconnect | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Prepare refusal no longer prevents explicit release; live observations still gate retirement [tooling/scripts/core-helper/UpdateRuntime.swift:80] |
| REG-759 | macOS helper install | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Undelivered silent upgrade skips45s polling; lost-ACK polling remains bounded and deliberate [apps/macos/Tono/Core/HelperManager.swift:1236] |
| REG-772 | Windows App adoption | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Repeat Adopt answer stays Held and cannot auto-connect again [apps/windows/app/src-tauri/src/tono/commands/update.rs:312] |
| REG-776 | Windows installer | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Bounded BFE gate runtime shutdown and deferred predecessor readiness compose [apps/windows/service/src/bin/install_service.rs:29] |
| REG-779 | Windows App update | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Generation-safe failed-Prepare convergence and automatic update-aware release [apps/windows/app/src-tauri/src/tono/commands/update.rs:220] |
| REG-784 | Windows App resync | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Failed update tail resumes catalog/policy synchronization [apps/windows/app/src-tauri/src/tono/commands/quit.rs:446] |
| REG-793 | Windows failed Prepare | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Post-stop failed Prepare is selective with #1007; early failures use #1040 [apps/windows/service/src/core/update.rs:569] |
| REG-794 | macOS helper install | Sol (Codex acct 2, R4-UpdateInstall) | P2 | issue #1071 | Abandoned upgrade releases ordinary network but uses explicit disarm and drops AI floor [apps/macos/Tono/Core/HelperManager.swift:259] |
| REG-801 | Windows manual installer | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Recovered file-lock rollback retains verified app/core candidates [apps/windows/service/src/bin/install_service.rs:1396] |
| REG-824 | Windows recovery task | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Registration and retirement both use OS-reported system directory [apps/windows/service/src/core/update.rs:1128] |
| REG-840 | macOS update launch | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Status timeout/write failure uses bounded existing repair; forbidden/malformed response remains refusal [apps/macos/Tono/Core/RuntimeCleanup.swift:265] |
| REG-844 | Windows update DNS proof | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Missing-snapshot healing stays disabled while the barrier is wanted [apps/windows/service/src/core/dns/mod.rs:3120] |
| REG-858 | Windows update recovery | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Recorded suspended successor is resumed and failed Service restart releases selectively [apps/windows/service/src/bin/install_service/update_executor.rs:377] |
| REG-891 | macOS pending update monitor | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Exhausted TUN loss cannot take explicit pending-update Disconnect [apps/macos/Tono/Services/AppState+Connect.swift:722] |
| REG-911 | Windows successor identity | Sol (Codex acct 2, R4-UpdateInstall) | P2 | issue #1055 (already reported) | TargetVerified early recovery bypasses publication clock fallback [apps/windows/service/src/bin/install_service/update_executor.rs:393] |
| REG-925 | Windows update proxy clear | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Concurrent resets use registered notification and retry [apps/windows/app/src-tauri/src/core/sysopt.rs:151] |
| REG-961 | Windows App/Service update | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Failed process spawn releases before Launching; App preserves actual error disposition [apps/windows/service/src/core/update.rs:603] |
| REG-971 | macOS update failure | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Emergency/update release restores saved DNS and applies AI floor [tooling/scripts/core-helper/UpdateExecutor.swift:78] |
| REG-978 | Windows update restart | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Failed restart uses AI-preserving recovery with strict checks [apps/windows/service/src/bin/install_service/update_executor.rs:611] |
| REG-980 | Windows update credentials | Sol (Codex acct 2, R4-UpdateInstall) | P2 | issue #1055 (already reported) | Explicit exit flush is correct; native hard termination is uncovered sibling [apps/windows/app/src-tauri/src/tono/commands/quit.rs:401] |
| REG-991 | macOS update suspension | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Reload handle and queued completion retired only after cancelled work drains [apps/macos/Tono/Services/AppState+NativeUpdate.swift:34] |
| REG-993 | macOS update download | Sol (Codex acct 2, R4-UpdateInstall) | — | ok | Resource deadline bounds progressing metadata transfer; package retains own900s limit [apps/macos/Tono/Services/NativeUpdateDownload.swift:23] |
| DUP-WIN-INSTALLER-PREP-CANDIDATES | Windows installer | Sol (Codex acct 2, R4-UpdateInstall) | P2 | duplicate of #801 residual; codex2 installer retry work in flight | Unpublished preparation error deletes app/core candidates needed by NSIS retry [apps/windows/service/src/bin/install_service.rs:1358] |
| MAC-UPD-DUP1 | macOS update/install | Sol (Codex acct 2, R4-UpdateInstall) | — | duplicate of #763 | Package FIFO/open-input freeze [tooling/scripts/core-helper/UpdatePackage.swift:113] |
| MAC-UPD-DUP2 | macOS update/install | Sol (Codex acct 2, R4-UpdateInstall) | — | duplicate of #979 | Installed-floor metadata signature reread [tooling/scripts/core-helper/UpdatePackage.swift:79] |
| MAC-UPD-DUP3 | macOS update/install | Sol (Codex acct 2, R4-UpdateInstall) | — | duplicate of #785 | Released network remains displayed as held after retirement refusal [apps/macos/Tono/Services/AppState+NativeUpdate.swift:132] |
| MAC-UPD-DUP4 | macOS update/install | Sol (Codex acct 2, R4-UpdateInstall) | — | duplicate of #795 | Protected Offline successor cannot commit after helper startup release [apps/macos/Tono/Models/UpdateContractV1.swift:347] |
| R4UPD-MAC-RETIRE-CLEANUP | macOS update retirement | Sol (Codex acct 2, R4-UpdateInstall) | P2 | real-fixed #1064 | Cleanup failure clears retry owner and lets a later update accept the old loaded executor [tooling/scripts/core-helper/UpdateTransaction.swift:407] |
| R4UPD-MAC-UPGRADE-AI-HOLD | macOS helper install | Sol (Codex acct 2, R4-UpdateInstall) | P2 | real-unfixed issue #1071: compatible privileged selective recovery contract needed | Abandoned upgrade uses explicit disarm and drops AI hold; older helpers lack selective release [apps/macos/Tono/Core/HelperManager.swift:259] |
| R4UPD-WIN-CAPTURE-EARLY-HOLD | Windows update handoff | Sol (Codex acct 2, R4-UpdateInstall) | P2 | real-unfixed issue #1082: preserve unconsumed retry; live-Service hold, later verified-intent restart can rescue; native injection unavailable | Pre-consumption user-token capture refusal bypasses failed-update release [apps/windows/service/src/bin/install_service/update_executor.rs:416] |
| R4UPD-WIN-EXECUTOR-FAILURE-RELEASE | Windows update executor | Sol (Codex acct 2, R4-UpdateInstall) | P1 | real-fixed #1075 | Task-registration refusal durably rolls back but bypasses selective failure release [apps/windows/service/src/bin/install_service/update_executor.rs:433] |
| R4UPD-WIN-RECOVERY-FLOOR | Windows update identity | Sol (Codex acct 2, R4-UpdateInstall) | P2 | duplicate of issue #1055 / R3REGW-RECOVERY-PUBLICATION-FLOOR | Early verified-publication recovery fails to initialize publication start clock [apps/windows/service/src/bin/install_service/update_executor.rs:393] |
| R4UPD-WIN-ROLLEDBACK-RECOVERY | Windows update recovery | Sol (Codex acct 2, R4-UpdateInstall) | P2 | real-unfixed issue #1081: needs replayable finalization without Service restart loop | Interruption after durable rollback before release is skipped by startup and ONSTART recovery [apps/windows/service/src/bin/install_service/update_executor.rs:385] |
| R4UPD-WIN-SUCCESSOR-FAILURE-HOLD | Windows update executor | Sol (Codex acct 2, R4-UpdateInstall) | P1 | real-fixed #1075 (same themed finding/finalizer as R4UPD-WIN-EXECUTOR-FAILURE-RELEASE) | Failed successor creation after publication skips rollback-only selective release [apps/windows/service/src/bin/install_service/update_executor.rs:579] |
| WAPP-ADOPT-RETRY-RECONNECT | Windows App update | Sol (Codex acct 2, R4-UpdateInstall) | — | duplicate: #772 retains Held after any second answer; restore recovery checks adoption plus auth/connect epochs. | Retried same-process adoption authorizes repeated auto Connect [apps/windows/app/src-tauri/src/tono/commands/update.rs:312] |
| WAPP-UNOWNED-PROXY-CLEAR | Windows App update | Sol (Codex acct 2, R4-UpdateInstall) | — | duplicate: known H19-C-F1 explicitly lists installation/update proxy clear as remaining limitation; no new evidence or fix claimed. | Update clears non-Tono proxy with no restoration [apps/windows/app/src-tauri/src/tono/commands/update.rs:180 / apps/windows/app/src-tauri/src/core/proxy_control.rs:177] |
| WAPP-UPDATE-AI-HOLD | Windows App update | Sol (Codex acct 2, R4-UpdateInstall) | — | duplicate: #1040 wires apply_narrow through additive request and actual WFP release; old Service rejects unknown op rather than silently dropping intent. | Early staging failure uses explicit update Disconnect and clears AI hold [apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:267] |
| WAPP-UPDATE-CONNECTING-CLEANUP | Windows App update | Sol (Codex acct 2, R4-UpdateInstall) | — | duplicate: WIN-UPDATE-CONNECTING-CLEANUP/#1046, explicitly excluded from this audit task; decision-blocked P2 already reported. | Armed Connecting retired by failed update has no automatic network release [apps/windows/app/src-tauri/src/tono/commands/update.rs:277] |
| WAPP-UPDATE-EXPIRY | Windows App update | Sol (Codex acct 2, R4-UpdateInstall) | — | duplicate: BRICK-W6 and decision 025 explicitly known; manual update Disconnect uses separate retirement path. | 48h receipt expiry fences recovery Connect [apps/windows/service/src/core/update.rs:739] |
| WIN-UPDATE-TOKEN-FLUSH | Windows App update | Sol (Codex acct 2, R4-UpdateInstall) | P2 | duplicate of issue #1055 / WIN-UPDATE-TOKEN-FLUSH | Executor hard termination bypasses pending rotated-token vault flush [apps/windows/app/src-tauri/src/tono/commands/update.rs:201] |

### R4-KSdeep (finished 23:48 MT; 29 hypotheses, 13 FP, PRs: #1074 #1087)
| ID | Area | Model | Sev | Verdict | Description [location] |
|---|---|---|---|---|---|
| R4KS-PID-REUSE | Windows Core | Sol (Codex acct 2, R4-KSdeep) | P2 | duplicate #1012 cached identity fences fallback | Watchdog cleanup targets recycled PID [manager.rs:1146] |
| R4KS-DEAD-PID | Windows Core | Sol (Codex acct 2, R4-KSdeep) | P2 | duplicate #999 PID clears before awaits | Confirmed-dead PID remains published during cleanup [manager.rs:868] |
| R4KS-FAILED-CHILD-LOCK | Windows Core | Sol (Codex acct 2, R4-KSdeep) | P1 | duplicate existing one-guard fix | Tracked child cleanup recursively locks failed_child [manager.rs:772] |
| R4KS-BOOKKEEPING | Windows recovery | Sol (Codex acct 2, R4-KSdeep) | P2 | duplicate #1021/#1032 cleanup-failure limitation | Core retirement bookkeeping failure delays broad release [server/mod.rs:401] |
| R4KS-UNARMED-TOMBSTONE | Windows release | Sol (Codex acct 2, R4-KSdeep) | P2 | duplicate R3KS1-UNARMED-TOMBSTONE known #769 limitation | Unarmed tombstone error skips requested AI disposition [windows_kill_switch.rs:2764] |
| R4KS-STRICT-WATCHDOG | Windows WFP | Sol (Codex acct 2, R4-KSdeep) | decision | duplicate documented decision 027; not changed | Strict unhealthy watchdog releases after 30 ticks [windows_kill_switch.rs:3090] |
| R4KS-SELECTIVE-HANG | Windows AI hold | Sol (Codex acct 2, R4-KSdeep) | P2 | duplicate R3KS1-SELECTIVE-WORKER-HANG #988 limitation | Hung native command strands reconciler [selective_layer.rs:290] |
| R4KS-NRPT-BYPASS | Windows AI hold | Sol (Codex acct 2, R4-KSdeep) | decision | duplicate SFO-1 accepted-design boundary | Cached DNS DoH or literals bypass suffix hold [selective_fail_open.rs:36] |
| R4KS-LATE-HOLD | Windows AI hold | Sol (Codex acct 2, R4-KSdeep) | P2 | duplicate #988 revisioned worker | Late apply overrides newer Restore [selective_layer.rs:74] |
| R4KS-EARLY-HOLD-REMOVE | Windows AI hold | Sol (Codex acct 2, R4-KSdeep) | P2 | duplicate #976 removal follows exact successful install | Arm removes hold before replacement barrier exists [windows_kill_switch.rs:1317] |
| WIN-DIRECT-EXPIRY-LIVE-CORE | Windows recovery | Sol (Codex acct 2, R4-KSdeep) | P1 | real-fixed #1074 | Automatic broad release leaves TUN Core and its native strict-route filters alive [windows_kill_switch.rs:3100] |
| WIN-SELECTIVE-REAPPLY-GAP | Windows AI hold | Sol (Codex acct 2, R4-KSdeep) | P2 | real-fixed #1087 | Repeated apply deletes existing AI hold before reapplying [selective_layer.rs:82] |
| R4KS-GENERIC-LIVE-CORE | Windows recovery | Sol (Codex acct 2, R4-KSdeep) | P2 | duplicate W1-LIVE-CORE-RELEASE; safe teardown without a new install dependency remains unresolved | Generic WFP-only fallback may retain Core routes and DNS hijack [windows_kill_switch.rs:3127] |
| R4KS-DURABLE-AI-INTENT | Windows AI hold | Sol (Codex acct 2, R4-KSdeep) | P2 | duplicate issue #1077; another hunter verified and owns reporting | Automatic release can lose AI disposition across Service death [windows_kill_switch.rs:2799] |
| R4KS-OWNER-STARTUP-SPLIT | Windows startup | Sol (Codex acct 2, R4-KSdeep) | P2 | duplicate W1-UNVERIFIED-OWNER-RETIRE; intentional ambiguity guard needs a decision | Interrupted user takeover leaves unverified owner B paired with active owner A and healthy Blocked [windows_kill_switch.rs:3534] |
| R4KS-NETSH-SYSTEMROOT | Windows AI hold | Sol (Codex acct 2, R4-KSdeep) | P2 | duplicate issue #1085 R3REGW-SELECTIVE-NETSH-PATH | Hard-coded C Windows netsh path fails on another system drive [selective_fail_open.rs:106] |
