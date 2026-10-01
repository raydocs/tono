One verified P2 fixed in [#1027](https://github.com/raydocs/tono/pull/1027). No new P0/P1 proved. All eight assigned files reviewed.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| MAC-LOGS-PONG-UNSUPPORTED | WebSocket | P2 | CoreWebSocket.swift:375, baseline | Unsupported Pong watchdog repeatedly reconnects healthy logs and retains Core subscriptions | Fixed in #1027 |
| M12-DUP01 | DNS | — | ProtectedSystemResolver.swift:170 | Cached public DNS burst ends query prematurely | Duplicate #886 |
| M12-DUP02 | Sidecar | — | TonoSidecarService.swift:302 | Reused legacy PID blocks startup | Duplicate #788 |
| M12-DUP03 | WebSocket | — | CoreWebSocket.swift:96 | Receive errors leave stale feeds marked live | Duplicate #799 |
| M12-DUP04 | WebSocket | — | CoreWebSocket.swift:235 | Old logs publish under successor route context | Duplicate #762 |
| M12-FP01 | DNS | — | ProtectedDNSProbe.swift:16 | Product fake-IP pool rejected | False positive: explicitly recognized |
| M12-FP02 | DNS | — | ConfigPipeline+Runtime.swift:142 | Mihomo pool disagrees with probe | False positive: dormant product path |
| M12-FP03 | DNS | — | ProtectedSystemResolver.swift:109 | Native setup hangs Connect | False positive: independent deadline |
| M12-FP04 | DNS | — | ProtectedSystemResolver.swift:99 | Early cancellation leaks query | False positive: terminal-state cleanup |
| M12-FP05 | DNS | — | ProtectedDNSProbe.swift:111 | Foreign/truncated answer proves health | False positive: ownership/framing guards |
| M12-FP06 | DNS | — | ProtectedDNSProbe.swift:17 | Malformed historical prefix grants health | False positive: canonical IPv4 producers |
| M12-FP07 | DNS | — | AppState.swift:2298 | Browser scan blocks main actor | False positive: detached scan |
| M12-FP08 | DNS | — | ProtectedDNSProbe.swift:409 | Missing browser state grants unsafe defaults | False positive: intentional, tested policy |
| M12-FP09 | DNS | — | ProtectedDNSProbe.swift:373 | Managed precedence hides settings | False positive: tested per-key precedence |
| M12-U01 | DNS | — | ProtectedDNSProbe.swift:12 | Historical cache masks resolver bypass | Rejected: ordinary harmful trigger unproved |
| M12-FP10 | Sidecar | — | TonoSidecarService.swift:429 | CLI hangs product startup | False positive: bounded; shipping path disabled |
| M12-FP11 | Sidecar | — | TonoSidecarService.swift:601 | Partial SOCKS response grants health | False positive: exact-read validation |
| M12-FP12 | Sidecar | — | AppProfile.swift:9 | Hardcoded probe tears down transport | False positive: Home-US disabled |
| M12-FP13 | Sidecar | — | TonoSidecarService.swift:242 | Stop/start loses successor daemon | False positive: no current product trigger |
| M12-FP14 | Sidecar | — | TonoSidecarService.swift:323 | Dead daemon leaves blocked readers | False positive: termination supplies EOF |
| M12-FP15 | Sidecar | — | TonoSidecarService.swift:451 | CLI output exhausts memory | False positive: output limits |
| M12-FP16 | Proxy | — | AppState+Proxy.swift:264 | Failed selector change commits exit | False positive: protected replacement verifies TUN |
| M12-FP17 | Proxy | — | ProxyService.swift:172 | Latency failure loses protection | False positive: advisory data only |
| M12-FP18 | Proxy | — | ProxyService.swift:191 | Unlimited latency concurrency | False positive: ten-task ceiling |
| M12-U02 | Proxy | — | ProxyService.swift:106 | Stale refresh overwrites selection | Rejected: ordinary harmful trigger unproved |
| M12-FP19 | Probe | — | ProtectedConnectivity.swift:236 | Advisory success grants Connected | False positive: TUN proof required |
| M12-FP20 | Probe | — | ProtectedConnectivityVerifier.swift:278 | Cancellation resumes twice | False positive: completion lock |
| M12-FP21 | Probe | — | ProtectedConnectivityVerifier.swift:304 | Waiting connection hangs forever | False positive: independent timeout |
| M12-FP22 | Probe | — | ProtectedConnectivityVerifier.swift:218 | CONNECT 200 proves dead exit healthy | False positive: origin HTTPS verification |
| M12-FP23 | Probe | — | ProtectedConnectivityVerifier.swift:334 | Unbounded headers freeze app | False positive: size/deadline bounds |
| M12-FP24 | Probe | — | AppState.swift:1641 | Obsolete verification publishes health | False positive: generation/cancellation checks |
| M12-FP25 | WebSocket | — | CoreWebSocket.swift:177 | Old frame mutates successor | False positive: task identity guards |
| M12-FP26 | WebSocket | — | CoreWebSocket.swift:104 | Reconnect resurrects stopped session | False positive: intent/cancellation guards |
| M12-FP27 | WebSocket | — | CoreWebSocket.swift:433 | Disconnect leaks sockets | False positive: session invalidation |
| M12-FP28 | WebSocket | — | CoreWebSocket.swift:94 | Invalid frames falsely recover feed | False positive: additional producer violation required |
| M12-FP29 | Controller | — | CoreControllerClient.swift:286 | Readiness cancellation hangs | False positive: bounded requests and cancellation checks |

[#1027](https://github.com/raydocs/tono/pull/1027): **merge-commit auto-merge enabled**, `needs-hardware` present, no `ui-review`. Core input and policy checks passed; app build/XCTest and privileged tests remain queued. Swift could not run locally.

Protocol evidence: **12 log handshakes, zero Pongs, healthy controller, descriptors 8→20** using the official Linux binary at pinned source. Protection policy is unchanged.

**36 hypotheses:** one fix, four duplicates, 31 rejected—29 guarded false positives and two unproved candidates. No unfinished source areas; native validation remains pending.

[Full report](/workspace/w1-codex/out/R3-M12/report.md) · [Evidence](/workspace/w1-codex/out/R3-M12/socket-evidence/README.txt)