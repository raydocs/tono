# W1-sol-win-app: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 21:19 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 820 | hunt/sol-winapp-shared-status-listener | none | yes | fix(windows): reuse the live shared status listener |
| 828 | hunt/sol-winapp-dns-callback-lifetime | needs-hardware | yes | fix(windows): retain DNS completion through callback return |
| 898 | hunt/sol-winapp-direct-restore-cancellation | needs-hardware | yes | fix(windows): let Restore cancel a stalled DIRECT controller reload |
| 916 | hunt/sol-winapp-upload-identifier-redaction | none | yes | fix(windows): redact account identifiers from uploaded audit segments |
| 932 | hunt/sol-winapp-account-cache-scope | none | yes | fix(windows): isolate account card caches by sign-in generation |
| 951 | hunt/sol-winapp-activity-process-key | none | yes | fix(windows): keep Activity process families limited to declared keys |
| 980 | hunt/sol-winapp-quit-vault-flush | none | yes | fix(windows): flush rotated session credentials on committed exit |
| 984 | hunt/sol-winapp-singleton-proxy | none | yes | fix(windows): bypass inherited proxies for singleton notification |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| W1-CONNECT-BUDGET | A1 | — | apps/windows/app/src-tauri/src/tono/connection/transaction.rs:25 | Cumulative connect timeouts could hang indefinitely | false-positive shared 240-second deadline and cancellation bound stages; deliberate cold-start budget |
| W1-CONNECTION-RACES | A1 | P3 | apps/windows/app/src-tauri/src/tono/connection.rs:275 | Duplicate fail_connect release and stale recovery selection | duplicate #798 |
| WIN-STATUS-LISTENER-LEAK | A10 | P3 | apps/windows/app/src/services/tono.ts:861 | Later page mounts leak backend status listeners and duplicate callbacks | real-fixed #820 |
| WIN-DNS-CALLBACK-LIFETIME | A8 | P2 | apps/windows/app/src-tauri/src/tono/windows_dns.rs:149 | DNS deadline wake may free completion before callback notification | real-fixed #828 |
| WIN-RESTORE-BEFORE-DISCOVERY | A9/A1 | — | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:342 | Startup Restore reports success without releasing undiscovered Service protection | false-positive no proven production UI caller before discovery; cold AccountState is SignedOut and Restore hidden |
| WIN-DIRECT-RESTORE-WRITER-DELAY | A1 | P1 | apps/windows/app/src-tauri/src/tono/connection/direct.rs:1211 | A stalled DIRECT controller reload holds lifecycle reader for 120 seconds and blocks Restore | real-fixed #898 |
| WIN-LOG-UPLOAD-IDENTIFIERS | A9 | P2 | apps/windows/app/src-tauri/src/tono/log_upload.rs:223 | Scoped raw-log uploads include sign-in email and revoked-device identifier | real-fixed #916 |
| W1-DIRECT-CALLER-CANCEL | A1 | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:330 | Caller cancellation drops a successful pending DIRECT commit | false-positive overlay caller is detached and never registered for abortion |
| W1-HOME-SOCKS-ENDPOINT | A1 | — | apps/windows/app/src-tauri/src/tono/connection/endpoints.rs:25 | Residential SOCKS5 is missing a physical WFP permit | false-positive upstream uses the tunneled Tono-Exit dialer |
| W1-DIRECT-DNS-TEARDOWN | A1 | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:464 | Optional DNS resolution error tears down healthy tunnel | false-positive pre-bracket failures skip overlay and preserve full tunnel |
| W1-DIRECT-SELECTION-RACE | A1 | — | apps/windows/app/src-tauri/src/tono/connection/direct.rs:570 | DIRECT activation races selected-node or policy publication | false-positive policy readers and writers serialize snapshots through commit |
| W1-SCHTASKS-QUOTING | A9 | — | apps/windows/app/src-tauri/src/utils/schtasks.rs:1 | Spaces or non-ASCII paths corrupt scheduled task arguments | false-positive XML escaping UTF-16 and separate command arguments preserve paths |
| W1-DIAGNOSTICS-WORKERS | A9 | — | apps/windows/app/src-tauri/src/tono/commands/diagnostics.rs:1 | Stalled native diagnostics probes accumulate unlimited workers | false-positive worker retains semaphore and async probes have deadlines |
| W1-SUPPORT-ACCOUNT-TOCTOU | A9 | — | apps/windows/app/src-tauri/src/tono/commands/support.rs:1 | Support preview crosses account replacement or report mutation | false-positive generation identity expiry and single-use frozen body guards |
| W1-LEGACY-SUBSCRIPTION-BODY | A9 | — | apps/windows/app/src-tauri/src/utils/network.rs:1 | Unbounded legacy subscription response exhausts memory | false-positive no production caller and deep-link subscription intake disabled |
| W1-TELEMETRY-EMAIL | A9 | — | apps/windows/app/src-tauri/src/tono/telemetry.rs:1 | Ordinary telemetry includes sign-in emails | false-positive sign-in kinds excluded and fields whitelisted |
| W1-SIGNIN-FAIL-SECRET | A9 | — | apps/windows/app/src-tauri/src/tono/audit.rs:362 | Sign-in failure text bypasses local credential redaction | false-positive no realistic credential-bearing current error source proved |
| W1-TERMINAL-PIPE-TIMEOUT | A9 | P2 | apps/windows/app/src-tauri/src/tono/commands/terminal.rs:1 | Reader joins can outlive terminal subprocess timeout | false-positive synthetic reproduction only no real Windows trigger proved; deferred lead |
| W1-STATUS-PUSH-RACE | A10 | — | apps/windows/app/src/hooks/use-tono.ts:1 | Old status invoke overwrites newer pushed state | false-positive SWR mutation ordering rejects older fetch results |
| W1-NATIVE-WS-CLOSE | A10 | P2 | apps/windows/crates/tono-plugin-core/src/commands.rs:258 | Renderer close cannot pass full native WebSocket identifier | duplicate #834 |
| W1-WS-HANDSHAKE | A10 | P2 | apps/windows/app/src/hooks/use-mihomo-ws-subscription.ts:1 | Hung handshake or late init wedges socket subscription | duplicate #807/#768 |
| W1-RELEASE-NOTIFY | A5 | — | apps/windows/app/src-tauri/src/tono/state.rs:1 | Lifecycle completion misses waiting release callers | false-positive notification enrolled before checking completion result |
| W1-MONITOR-SELF-ABORT | A5/A1 | — | apps/windows/app/src-tauri/src/tono/state.rs:156 | Monitor replacement aborts its own reconnect tail | false-positive current Tokio task identity handled when retiring tasks |
| W1-TRANSPORT-POST-REPLAY | A5 | — | apps/windows/app/src-tauri/src/tono/transport.rs:769 | Transport retries ambiguous POST errors and duplicates mutation | false-positive transport retry predicate checked at every fallback |
| W1-API-RESPONSE-CAP | A5 | — | apps/windows/app/src-tauri/src/tono/transport.rs:1 | Normal API response body can exhaust memory | false-positive streamed response has 2 MiB cap |
| W1-DOH-RESPONSE-CAP | A5 | P2 | apps/windows/app/src-tauri/src/tono/transport.rs:689 | Trusted DoH resolver body is read without size cap | duplicate previous slot deferred lead |
| W1-CACHE-ACL | A5 | — | apps/windows/app/src-tauri/src/tono/state.rs:1 | Cache ACL admits another ordinary Windows user | false-positive exact three-principal protected DACL and owner checks |
| W1-CONNECTION-FEED-GROWTH | A10 | — | apps/windows/app/src/hooks/use-connection-data.ts:161 | Connection feed grows without bound | false-positive active and closed snapshot counts capped |
| W1-WINDOW-REJECTION | A10 | — | apps/windows/app/src/providers/window/window-provider.tsx:44 | Native window promise rejection crashes machine | false-positive no fatal rejection path proved |
| W1-TUNNEL-API-5XX | A5 | P2 | apps/windows/app/src-tauri/src/tono/transport.rs:630 | Tunnel fallback discards authenticated upstream API 5xx as proxy failure | false-positive deferred candidate: no proven user-visible failure; needs direct failure plus upstream 5xx |
| W1-LOCAL-EVIDENCE-UTF8 | A8 | — | apps/windows/app/src-tauri/src/tono/local_evidence.rs:166 | Evidence tail slicing or IPC hex input panics | false-positive newline ensures UTF-8 boundary; hex ASCII even-length and 8 MiB cap |
| W1-AUDIT-LOCK-ORDER | A8 | — | apps/windows/app/src-tauri/src/tono/audit.rs:807 | Audit writer and owner locks deadlock | false-positive writer guard dropped before owner lock; consistent order no await |
| W1-ENCRYPTED-DNS-DETECTOR | A8 | — | apps/windows/app/src-tauri/src/tono/encrypted_dns.rs:76 | Encrypted DNS detector loses user internet | false-positive bool-only detector has no production caller or OS mutation |
| W1-SIGNED-APP-RECONNECT | A8 | P1 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:431 | Signed app path change needs protected reconnect | duplicate #757 |
| W1-BROWSER-DNS-WORKER | A8 | — | apps/windows/app/src-tauri/src/tono/browser_dns.rs:92 | Timed-out browser scans accumulate stalled OS workers | false-positive requires repeated independent native filesystem stalls; no reproduction |
| W1-SIGNER-ACL-CACHE | A8 | — | apps/windows/app/src-tauri/src/tono/signed_apps.rs:925 | Signer cache trusts stale ancestor ACLs | false-positive requires administrator ACL alteration; no realistic trigger proved |
| W1-BROWSER-READ-GROWTH | A8 | — | apps/windows/app/src-tauri/src/tono/browser_dns.rs:178 | Browser config read grows past pre-read metadata cap | false-positive requires concurrent huge replacement; no realistic browser trigger |
| W1-INITIAL-TUN-PROOF | A1 | — | apps/windows/app/src-tauri/src/tono/connection/probes.rs:1 | Connect accepts Locked without rendered tunnel permit | false-positive later full-tunnel HTTPS proof cannot pass without initial permit |
| W1-CONTROLLER-NAME-QUOTING | A1 | — | apps/windows/app/src-tauri/src/tono/connection/controller.rs:1 | Non-ASCII or quoted selected node name corrupts controller request | false-positive JSON and path-safe request construction preserve names |
| WIN-STALE-SIGNED-APP-PATHS | A1 | P2 | apps/windows/app/src-tauri/src/tono/connection.rs:366 | Fresh full-tunnel attempt retains old DIRECT path snapshot and can reconnect every two minutes after app update | duplicate #900 WIN-WECHAT-PATH-STALE |
| WIN-ACCOUNT-CACHE-OWNERSHIP | A10 | P1 | apps/windows/app/src/tono-ui/TonoAccountCard.tsx:52 | Replacement sign-in keeps prior account device metadata when new fetch fails | real-fixed #932 |
| W1-UPDATE-OFFER-LATCH | A10 | — | apps/windows/app/src/components/setting/mods/update-viewer.tsx:242 | Rejected update offer prevents retry | false-positive deliberate same-manifest retry latch; no runtime network effect |
| W1-UPDATE-MARKDOWN | A10 | — | apps/windows/app/src/components/setting/mods/update-viewer.tsx:242 | Updater markdown can inject remote active content | false-positive native Offer omits body; no live input route |
| W1-PRIVACY-TOGGLE-RACE | A10 | — | apps/windows/app/src/pages/settings.tsx:285 | Rapid toggles silently enable uploads | false-positive useLockFn serializes controlled state; unintended enable unproved |
| W1-SCM-EXECUTOR-HANG | A10 | — | apps/windows/app/src/services/tono.ts:1 | SCM prerequisites block async executor | false-positive spawn_blocking and coalesced pending promises |
| W1-LATE-ACCOUNT-RESPONSE | A5 | — | apps/windows/crates/tono-core/src/auth.rs:1 | Late account A HTTP result adopted by B | false-positive authorized_for_identity checks before and after response |
| W1-HEALTH-OWNER | A10 | — | apps/windows/app/src/pages/tono/health-model.ts:61 | Stale account health evidence permits repair | false-positive healthIsCurrent compares scope and all connection/catalog generations |
| W1-SUPPORT-PREVIEW-OWNER | A10 | — | apps/windows/app/src/tono-ui/SupportReportAction.tsx:31 | Support preview survives replacement sign-in | false-positive action key includes accountState/scope and backend fences dispatch |
| W1-ACTIVITY-CLOSE-OWNER | A10 | — | apps/windows/app/src/pages/tono/activity.tsx:231 | Stale Activity close hits new core | false-positive UI supplies generation and backend verifies it |
| W1-VAULT-MIGRATION-ORDER | A5 | — | apps/windows/app/src-tauri/src/tono/credentials.rs:504 | Legacy vault rebind overwrites newer token | false-positive vault lock reads latest durable value before rebind |
| W1-CREDENTIAL-LOAD-RETRY | A5 | — | apps/windows/app/src-tauri/src/tono/commands/account.rs:74 | Transient vault failure sticks across Retry | false-positive error clears and credentials_loaded remains false; stale hydration rejected |
| W1-VAULT-MAIN-THREAD | A5 | — | apps/windows/app/src-tauri/src/tono/credentials.rs:574 | Native vault calls hang async executor | false-positive spawn_blocking and memory/FIFO trait; flush waits without product locks |
| W1-PENDING-MARKER-RELOGIN | A5 | — | apps/windows/app/src-tauri/src/tono/credentials.rs:281 | Pending marker disowns unsaved session on crash | false-positive documented durable vault ownership policy |
| WIN-VAULT-WRITE-RETRY | A5 | P1 | apps/windows/app/src-tauri/src/tono/credentials.rs:743 | Transient vault write loses durable sign-in or rotated token | duplicate #843; late rotation still needs a flush trigger before Quit (owner limitation) |
| W1-RESTORE-CALLER-CANCEL | A9/A1 | — | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:330 | UI timeout abandons network release | false-positive detached coordinator retains complete teardown ownership |
| W1-RESTORE-SESSION-PROOF | A9/A1 | — | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:347 | Lost core session prevents Restore | false-positive release is owner-only and armed-policy gated; core proof not required |
| W1-RESTORE-LATE-AUTH | A9 | — | apps/windows/app/src-tauri/src/tono/commands/restore.rs:100 | Late authentication re-arms after Restore | false-positive protection applied before me; update recovery checks connect epoch |
| W1-RESTORE-PROXY-CLEAR | A9/A1 | — | apps/windows/app/src-tauri/src/tono/connection/disconnect.rs:1 | Ignored proxy clear failure strands Windows internet | false-positive current Windows Tono never enables system proxy; concurrent clear already #925 |
| W1-RESTORE-SCM-HANG | A9/A1 | P1 | apps/windows/app/src-tauri/src/tono/connection.rs:3189 | Native SCM probe can delay release admission | duplicate #912 owned by another hunter |
| W1-RESTORE-CORE-OWNER | A9/A1 | P1 | apps/windows/service/src/core/server/handlers.rs:405 | Missing owner record skips core teardown | duplicate merged #873 |
| W1-RESTORE-DNS-COMPENSATION | A9/A1 | P1 | apps/windows/service/src/core/server/handlers.rs:405 | Core stop after DNS restoration failure leaves stale snapshot semantics | duplicate #846/#866; blind disarm would require AI/strict policy decision |
| WIN-ACTIVITY-PROCESS-PROTOTYPE | A10 | P2 | apps/windows/app/src/pages/tono/activity-model.ts:133 | Constructor.exe process becomes inherited Object constructor and crashes Activity aggregation | real-fixed #951; Windows game socket ownership inferred from primary developer executable/multiplayer evidence |
| W1-TRAY-STREAM-BACKLOG | A9 | — | apps/windows/app/src-tauri/src/utils/connections_stream.rs:78 | Traffic event backlog hangs tray | false-positive bounded capacity-8 try_send drops overflow; stale deadline remains bounded |
| W1-SPEED-ZERO-PANIC | A9 | — | apps/windows/app/src-tauri/src/utils/speed.rs:22 | Zero byte rate panics in logarithm | false-positive zero returns before ilog2 and unit index capped |
| W1-WINDOW-CLOSE-DESTROYS | A9 | — | apps/windows/app/src-tauri/src/utils/window_manager.rs:198 | Window close destroys runtime instead of hiding | false-positive lib.rs close handler prevents destruction until committed exit |
| W1-WINDOW-CREATION-OVERLAP | A9 | — | apps/windows/app/src-tauri/src/utils/window_manager.rs:123 | Overlapping window creation crashes app | false-positive 625ms limiter and unique-label builder reject duplicate; no crash path |
| W1-YAML-EMITTER-NETWORK | A9 | — | apps/windows/app/src-tauri/src/utils/yaml_emitter.rs:4 | YAML emitter corrupts active network config | false-positive no production caller; live runtime uses tono-core generator |
| W1-MAC-UTILS-ON-WINDOWS | A9 | — | apps/windows/app/src-tauri/src/utils/mod.rs:7 | macOS helper logic runs on Windows | false-positive module and launch-hook cfg gates exclude Windows |
| W1-DORMANT-URL-MASK | A9 | — | apps/windows/app/src-tauri/src/utils/help.rs:1 | URL mask preserves credentials in uploaded error text | false-positive helper has no live caller; no upload path |
| W1-TRAY-CLEANUP-CANCEL | A9 | P3 | apps/windows/app/src-tauri/src/core/tray/speed_task.rs:242 | Tray stop interrupts reader cleanup | false-positive narrow cancellation race and no frontend toggle caller; unverified |
| W1-CONDA-CONSTRUCTOR-OWNER | A10 | — | apps/windows/app/src/pages/tono/activity-model.ts:133 | Conda constructor wrapper owns triggering socket | false-positive wrapper can delegate network calls to python.exe; not used as evidence |
| W1-NODE-LABEL-PROTOTYPE | A10 | P2 | apps/windows/app/src/pages/tono/node-meta.ts:80 | Unexpected constructor catalog label can return inherited non-string metadata | false-positive customer trigger unverified; required real City-Codename naming and current fleet avoid it; helper input edge deferred |
| W1-STALE-ROUTE-RECOMMENDATION | A10 | — | apps/windows/app/src/pages/tono/route-preferences.ts:1 | Old or cross-account route evidence selects new session route | false-positive scope revision TTL guards and backend idle admission |
| W1-TRAFFIC-SAMPLER-GROWTH | A10 | — | apps/windows/app/src/utils/traffic-sampler.ts:1 | Invalid retention/ratio grows sampler without bound | false-positive fixed internal configs and bounded moving heads |
| W1-SEARCH-REGEX-HANG | A10 | — | apps/windows/app/src/utils/search-matcher.ts:24 | User regex freezes renderer | false-positive compileStringMatcher has no runtime caller |
| W1-LEGACY-POLYFILLS | A10 | — | apps/windows/app/src/polyfills/matchMedia.js:1 | Old compatibility fallback crashes current WebView | false-positive Edge109 minimum and native feature guards avoid fallback |
| WIN-QUIT-ROTATED-TOKEN-DURABILITY | A5/A9 | P1 | apps/windows/app/src-tauri/src/tono/commands/quit.rs:358 | Committed Quit skips the retry flush for a transiently failed rotated-token vault write | real-fixed #980 |
| W1-BOOTSTRAP-IPC-HANG | A10 | — | apps/windows/app/src/main.tsx:109 | Hung preload blocks the app indefinitely | false-positive explicit 2-second deadline renders the app; late preload detached |
| W1-OVERLAY-STRICT-REMOUNT | A10 | — | apps/windows/app/src/pages/_layout/hooks/use-loading-overlay.ts:14 | StrictMode cancels loading removal and blocks app access | false-positive data-hidden immediately disables pointer events and hides overlay |
| W1-TRAFFIC-WORKER-BACKLOG | A10 | — | apps/windows/app/src/hooks/use-traffic-monitor.ts:270 | Worker startup failures build an unbounded queue | false-positive construction failure switches inline; no production queue-growth trigger proved |
| W1-TRAFFIC-ACTIVE-OWNER | A10 | — | apps/windows/app/src/hooks/use-mihomo-ws-subscription.ts:179 | Shared owner starves another consumer live status | false-positive Dashboard and Tray run in separate WebViews with independent modules |
| W1-ACCOUNT-MODAL-SCOPE | A10 | — | apps/windows/app/src/tono-ui/TonoAccountCard.tsx:65 | Revoke modal retains previous account device | false-positive actual replacement sign-in unmounts Account; #932 regression covers navigation |
| W1-TRAY-SIGNEDOUT-CONNECT | A10 | — | apps/windows/app/src/tono-ui/TrayPanel.tsx:121 | Signed-out Tray arms protection | false-positive backend checks Ready before connection admission |
| W1-SERVER-UNMOUNT-CANCEL | A10 | — | apps/windows/app/src/pages/tono/servers.tsx:159 | Server page cleanup cancels another window tests | false-positive no second production test window or realistic conflicting caller |
| W1-WS-CLEAN-CLOSE | A10 | — | apps/windows/crates/tono-plugin-core/src/mihomo.rs:50 | Clean native socket close leaves frontend subscription stale | false-positive core restart changes generation; no realistic same-generation clean close proved; deferred lead |
| W1-POLICY-LOCK-INVERSION | A5 | — | apps/windows/app/src-tauri/src/tono/state.rs:779 | Publication and selection locks deadlock reconnect | false-positive publication locks precede state locks and release before reconnect |
| W1-SELECTION-TRUNCATION | A5 | — | apps/windows/app/src-tauri/src/tono/state.rs:857 | Interrupted selection hint write loses internet | false-positive corrupt optional hint becomes absent; validated catalog supplies fallback |
| W1-TRANSPORT-WALK-HANG | A5 | — | apps/windows/app/src-tauri/src/tono/transport.rs:550 | Alternate transport walk can hang indefinitely | false-positive nominal budget can overrun one bounded attempt; outer operation deadlines also bound it |
| W1-VAULT-QUEUE-OVERFLOW | A5 | — | apps/windows/app/src-tauri/src/tono/credentials.rs:732 | Single stalled vault overflows token mutation queue | false-positive no realistic 64 distinct queued-mutation trigger; rejection before memory commit |
| W1-PORT-EXHAUSTION | A9 | — | apps/windows/app/src-tauri/src/utils/port.rs:11 | Fallback port wrap loops forever | false-positive fixed 64511-iteration bound and explicit None fallback |
| W1-LOG-FILENAME-UTF8 | A9 | — | apps/windows/app/src-tauri/src/utils/init.rs:107 | Non-ASCII log filename tail slicing panics | false-positive ASCII .log suffix guarantees the sliced end boundary |
| W1-KEY-LENGTH-PANIC | A9 | — | apps/windows/app/src-tauri/src/utils/dirs.rs:243 | Corrupt encryption key crashes startup | false-positive cipher length failure returns Result; stored fields have fallback parser |
| WIN-DIRECT-RESTORE-WRITER-DELAY-AUTO | A1 | P1 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1384 | Automatic health release never cancels the stalled DIRECT reader and normal internet remains Blocked about two minutes | real-unfixed follow-up to #898; cancellation-only opens AI sooner and existing best-effort AI fallback cannot guarantee top rule |
| W1-AUTO-HEALTH-AI-HOLD | A1 | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1391 | Automatic health release omits guaranteed secondary AI blocking | duplicate SFO-1/#738 and ZC-F1/#706; needs existing guaranteed-fallback decision/implementation |
| WIN-SINGLETON-INHERITED-PROXY | A9 | P3 | apps/windows/app/src-tauri/src/utils/server.rs:100 | Inherited HTTP proxy intercepts authenticated localhost notification and second launch fails after twenty seconds | real-fixed #984 |
| W1-SWITCH-HEARTBEAT | A1 | — | apps/windows/app/src-tauri/src/tono/commands/catalog.rs:286 | Hot switch aborts DIRECT heartbeat | false-positive only Reconnect invalidates generation; Switch preserves supervisors |
| W1-VIRTUAL-UPLINK | A1 | — | apps/windows/app/src-tauri/src/tono/connection/platform.rs:154 | Physical discovery selects Tono virtual adapter | false-positive hardware/type/description filters exclude virtual adapters |
| W1-STALE-PREPARE-CORE | A1 | — | apps/windows/service/src/core/server/handlers.rs:576 | Stale Prepare stops a successor Core | false-positive captured release epoch checked under lifecycle ownership |
| W1-LOST-START-OWNER | A1 | — | apps/windows/app/src-tauri/src/core/service/mod.rs:759 | Lost Start response leaves an unowned Core | false-positive proved generation advance adopts proposed session token; owner release handles absent local proof |
| W1-API-IDENTITY-LOCK | A1 | — | apps/windows/app/src-tauri/src/tono/connection.rs:322 | API identity and app state lock order deadlocks | false-positive memory-only epoch read and no reverse callback or await cycle |
| W1-STALE-MONITOR-RELEASE | A1 | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:1331 | Stale monitor releases replacement session | false-positive registered task retirement and generation checks protect normal path; remaining lead requires narrow race |
| W1-CATALOG-IDENTITY-OUTAGE | A1 | — | apps/windows/app/src-tauri/src/tono/connection/switch.rs:269 | Catalog identity rotation sustains an outage | false-positive protected probe rollback and cold reconstruction; no sustained single-failure P1 proved |
| W1-CONTROLLER-RESPONSE-GROWTH | A1 | — | apps/windows/app/src-tauri/src/tono/connection/controller.rs:156 | Controller JSON response exhausts memory | false-positive trusted local Core and no realistic customer workload proving exhaustion |
| W1-SIGNER-SUPERVISION | A1 | — | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:492 | Stalled signer discovery removes all supervision | false-positive separate network monitor and DIRECT heartbeat remain active |
| W1-SHORTCUT-FIND-GATE | A10 | — | apps/windows/app/src/utils/disable-webview-shortcuts.ts:12 | Keyboard shortcut suppression blocks Ctrl+F search | false-positive preventDefault does not stop event bubbling; layout still handles Ctrl+F |
| W1-TRAFFIC-FORMAT-PANIC | A10 | — | apps/windows/app/src/utils/parse-traffic.ts:8 | Invalid rate values throw and crash renderer | false-positive NaN infinity and negative inputs return strings; no throw verified in Node |
| W1-UPDATE-LATE-CALLBACK | A10 | — | apps/windows/app/src/components/setting/mods/update-viewer.tsx:213 | Late progress callback after route unmount corrupts update ownership | false-positive only retired React state changes; Service retains staging/install/recovery ownership |
