# W1-sol-win-app: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 18:55 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 820 | hunt/sol-winapp-shared-status-listener | none | yes | fix(windows): reuse the live shared status listener |
| 828 | hunt/sol-winapp-dns-callback-lifetime | needs-hardware | yes | fix(windows): retain DNS completion through callback return |
| 898 | hunt/sol-winapp-direct-restore-cancellation | needs-hardware | yes | fix(windows): let Restore cancel a stalled DIRECT controller reload |
| 916 | hunt/sol-winapp-upload-identifier-redaction | none | yes | fix(windows): redact account identifiers from uploaded audit segments |

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
| W1-CONNECTION-FEED-GROWTH | A10 | — | apps/windows/app/src/hooks/use-connection-store.ts:1 | Connection feed grows without bound | false-positive active and closed snapshot counts capped |
| W1-WINDOW-REJECTION | A10 | — | apps/windows/app/src/providers/window-provider.tsx:1 | Native window promise rejection crashes machine | false-positive no fatal rejection path proved |
| W1-TUNNEL-API-5XX | A5 | P2 | apps/windows/app/src-tauri/src/tono/transport.rs:630 | Tunnel fallback discards authenticated upstream API 5xx as proxy failure | real-unfixed low priority needs direct fallback failure plus upstream 5xx; reproduction pending |
| W1-LOCAL-EVIDENCE-UTF8 | A8 | — | apps/windows/app/src-tauri/src/tono/local_evidence.rs:166 | Evidence tail slicing or IPC hex input panics | false-positive newline ensures UTF-8 boundary; hex ASCII even-length and 8 MiB cap |
| W1-AUDIT-LOCK-ORDER | A8 | — | apps/windows/app/src-tauri/src/tono/audit.rs:807 | Audit writer and owner locks deadlock | false-positive writer guard dropped before owner lock; consistent order no await |
| W1-ENCRYPTED-DNS-DETECTOR | A8 | — | apps/windows/app/src-tauri/src/tono/encrypted_dns.rs:76 | Encrypted DNS detector loses user internet | false-positive bool-only detector has no production caller or OS mutation |
| W1-SIGNED-APP-RECONNECT | A8 | P1 | apps/windows/app/src-tauri/src/tono/connection/monitor.rs:431 | Signed app path change needs protected reconnect | duplicate #757 |
| W1-BROWSER-DNS-WORKER | A8 | — | apps/windows/app/src-tauri/src/tono/browser_dns.rs:92 | Timed-out browser scans accumulate stalled OS workers | false-positive requires repeated independent native filesystem stalls; no reproduction |
| W1-SIGNER-ACL-CACHE | A8 | — | apps/windows/app/src-tauri/src/tono/signed_apps.rs:925 | Signer cache trusts stale ancestor ACLs | false-positive requires administrator ACL alteration; no realistic trigger proved |
| W1-BROWSER-READ-GROWTH | A8 | — | apps/windows/app/src-tauri/src/tono/browser_dns.rs:178 | Browser config read grows past pre-read metadata cap | false-positive requires concurrent huge replacement; no realistic browser trigger |
| W1-INITIAL-TUN-PROOF | A1 | — | apps/windows/app/src-tauri/src/tono/connection/probes.rs:1 | Connect accepts Locked without rendered tunnel permit | false-positive later full-tunnel HTTPS proof cannot pass without initial permit |
| W1-CONTROLLER-NAME-QUOTING | A1 | — | apps/windows/app/src-tauri/src/tono/connection/controller.rs:1 | Non-ASCII or quoted selected node name corrupts controller request | false-positive JSON and path-safe request construction preserve names |
| WIN-STALE-SIGNED-APP-PATHS | A1 | P2 | apps/windows/app/src-tauri/src/tono/connection.rs:366 | Fresh full-tunnel attempt retains old DIRECT path snapshot and can reconnect every two minutes after app update | real-unfixed lower priority requires policy removal followed by signed-app path update |
| WIN-ACCOUNT-CACHE-OWNERSHIP | A10 | P1 | apps/windows/app/src/tono-ui/TonoAccountCard.tsx:52 | Replacement sign-in keeps prior account device metadata when new fetch fails | real-unfixed regression starting |
