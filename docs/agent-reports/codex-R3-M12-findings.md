# R3-M12: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 01:22 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1027 | hunt/sol-r3probe-quiet-logs | needs-hardware | yes | fix(macos): stop reconnecting quiet sing-box log streams |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| M12-FP01 | DNS | — | ProtectedDNSProbe.swift:16 | Current product fake-IP pool is rejected | false-positive explicit 198.18.16.0/20 recognition |
| M12-FP02 | DNS | — | ConfigPipeline+Runtime.swift:142 | Mihomo DNS range disagrees with probes | false-positive dormant YAML generation; production runtime always sing-box |
| M12-FP03 | DNS | — | ProtectedSystemResolver.swift:109 | Blocked native DNS setup hangs connect | false-positive independent deadline and single retained C owner |
| M12-FP04 | DNS | — | ProtectedSystemResolver.swift:99 | Pre-registration cancellation leaks query | false-positive terminal state and queued owner cleanup |
| M12-DUP01 | DNS | P1 | ProtectedSystemResolver.swift:170 | Cached public DNS burst ends protected query too early | duplicate #886 |
| M12-FP05 | DNS | — | ProtectedDNSProbe.swift:111 | Unrelated or truncated DNS answer proves health | false-positive transaction/question/flags/framing/CNAME ownership guards |
| M12-FP06 | DNS | — | ProtectedDNSProbe.swift:17 | Malformed historical fake-IP string grants health | false-positive production answers are IPv4 wire bytes or inet_ntop |
| M12-FP07 | DNS | — | AppState.swift:2298 | Browser diagnostic read blocks main actor | false-positive detached scan and fail-closed diagnostics |
| M12-FP08 | DNS | — | ProtectedDNSProbe.swift:409 | Missing browser state grants unsafe default | false-positive intentional tested default; managed policy still applies |
| M12-FP09 | DNS | — | ProtectedDNSProbe.swift:373 | Policy precedence masks browser settings | false-positive tested per-key precedence |
| M12-U01 | DNS | P2 | ProtectedDNSProbe.swift:12 | Historical cached fake-IP may mask active resolver path | false-positive unproved: no ordinary bypass established; intended compatibility plus stop flush and TTL30 |
| M12-FP10 | sidecar | — | TonoSidecarService.swift:429 | CLI failure hangs product startup | false-positive bounded 15s plus 2s watchdog; product skips CLI |
| M12-FP11 | sidecar | — | TonoSidecarService.swift:601 | Partial SOCKS reply grants health | false-positive greeting/header/full-payload exact-read guards |
| M12-FP12 | sidecar | — | Support/AppProfile.swift:9 | Hardcoded SOCKS health origin tears down live product | false-positive Home-US disabled in shipping profile |
| M12-FP13 | sidecar | — | TonoSidecarService.swift:242 | Stop/start actor reentrancy loses daemon | false-positive current profile skips daemon startup; account lifecycle serializes |
| M12-FP14 | sidecar | — | TonoSidecarService.swift:323 | Dead daemon leaves output readers blocked | false-positive child termination supplies pipe EOF |
| M12-FP15 | sidecar | — | TonoSidecarService.swift:451 | CLI output exhausts memory | false-positive 8MiB stdout/64KiB stderr limits |
| M12-FP16 | proxy | — | AppState+Proxy.swift:264 | Failed selector mutation commits main exit | false-positive protected exit uses config replacement and TUN proof |
| M12-FP17 | proxy | — | ProxyService.swift:172 | Latency failure tears down protection | false-positive latency is timestamped display/heartbeat data |
| M12-FP18 | proxy | — | ProxyService.swift:191 | Bulk latency sweep has unlimited concurrency | false-positive ten-task ceiling |
| M12-U02 | proxy | P2 | ProxyService.swift:106 | Stale refresh overwrites newer selection | false-positive unproved: narrow cancellation timing; no ordinary harmful trigger established |
| M12-DUP02 | sidecar | P3 | TonoSidecarService.swift:302 | Stale reused legacy PID blocks account startup | duplicate #788 |
| M12-FP19 | probe | — | ProtectedConnectivity.swift:236 | Advisory controller or mixed success grants Connected | false-positive only real TUN success grants Connected |
| M12-FP20 | probe | — | ProtectedConnectivityVerifier.swift:278 | Cancellation resumes HTTP continuation twice | false-positive OnceResume lock grants one terminal completion |
| M12-FP21 | probe | — | ProtectedConnectivityVerifier.swift:304 | Waiting NWConnection hangs connect forever | false-positive independent dispatch timeout |
| M12-FP22 | probe | — | ProtectedConnectivityVerifier.swift:218 | Local CONNECT 200 proves broken exit healthy | false-positive URLSession verifies origin HTTPS/certificate and expected response |
| M12-FP23 | probe | — | ProtectedConnectivityVerifier.swift:334 | Unbounded origin HTTP headers freeze app | false-positive 4096-byte cap and transaction deadline |
| M12-FP24 | probe | — | AppState.swift:1641 | Cancelled or obsolete verification publishes health | false-positive generation/cancellation checks after every I/O suspension |
| M12-FP25 | websocket | — | CoreWebSocket.swift:177 | Old socket frame updates successor runtime | false-positive task identity and stopped guards |
| M12-FP26 | websocket | — | CoreWebSocket.swift:104 | Reconnect resurrects stopped session | false-positive enabled/stopped/cancellation guards |
| M12-FP27 | websocket | — | CoreWebSocket.swift:433 | Disconnect leaks active sockets | false-positive stopAll cancels tasks and invalidates URLSession |
| M12-DUP03 | websocket | P3 | CoreWebSocket.swift:96 | Receive errors leave traffic/connection feeds falsely live | duplicate #799 merged |
| MAC-LOGS-PONG-UNSUPPORTED | websocket | P2 | apps/macos/Tono/Core/CoreWebSocket.swift:375 (baseline 262b1864) | Unsupported log Pong watchdog causes false reconnects and retained Core subscriptions | real-fixed #1027 (CI pending) |
| M12-DUP04 | websocket | P2 | CoreWebSocket.swift:235 | Old runtime log buffer publishes under successor route | duplicate #762 |
| M12-FP28 | websocket | — | CoreWebSocket.swift:94 | Malformed frames recover feed falsely | false-positive pinned producer emits compatible text JSON; additional protocol violation required |
| M12-FP29 | controller | — | CoreControllerClient.swift:286 | Readiness cancellation hangs | false-positive bounded requests/sleep budget and cancellation checks |
