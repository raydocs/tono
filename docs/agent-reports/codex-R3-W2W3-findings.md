# R3-W2W3: Codex (GPT-6.1 Sol) findings

Generated 2026-10-01 02:55 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| PR#1032 | hunt/sol-r3wfp-core-exhaustion | needs-hardware | yes | fix(windows): release protection after Core recovery exhausts |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R3-WFP-N01 | W2 | — | wfp/mod.rs:148 | Static WFP session leaves filters after Service exit | false-positive deliberate session survival with startup/watchdog reconciliation |
| R3-WFP-N02 | W2 | — | wfp/mod.rs:437 | Reboot keeps block but loses infrastructure permits | duplicate #753 persistent floor and namespace v12 |
| R3-WFP-N03 | W2 | — | wfp/mod.rs:975 | Residual provider/sublayer blocks traffic | false-positive inert without filters |
| R3-WFP-N04 | W2 | — | wfp/mod.rs:175 | Body or commit error skips transaction abort | false-positive explicit abort on both error paths |
| R3-WFP-N05 | W2 | — | wfp/mod.rs:166 | Unwind strands an open transaction | false-positive Engine Drop closes session and BFE aborts |
| R3-WFP-N06 | W2 | — | wfp/mod.rs:255 | Condition vectors invalidate native borrowed pointers | false-positive boxed pointees stay stable |
| R3-WFP-N07 | W2 | — | wfp/mod.rs:876 | Verification accepts extra stale DIRECT filters | false-positive exact provider key-set equality |
| R3-WFP-N08 | W2 | — | wfp_model.rs:617 | Moved executable inherits stale permit key | false-positive executable paths participate in endpoint/API keys |
| R3-WFP-N09 | W2 | — | wfp/mod.rs:1040 | Tunnel alias admits absent or physical interface | duplicate #676 presence and virtual/type proof |
| R3-WFP-N10 | W2 | — | wfp/mod.rs:341 | NDP ICMP field maps to a port incorrectly | false-positive documented IP_LOCAL_PORT ICMP_TYPE alias |
| R3-WFP-N11 | W2 | — | wfp_model.rs:606 | Established flows bypass removed permits | false-positive ALE reauthorizes on next packet after filter change |
| R3-WFP-N12 | W2 | — | wfp/mod.rs:1011 | Concurrent emergency cleanup erases replacement policy | false-positive owner coordination and deliberate uninstall fallback proof |
| R3-WFP-N13 | W2 | — | wfp/mod.rs:922 | Unresolved app identity returns without protective policy | false-positive failure installs block without unresolved permits |
| R3-WFP-N14 | W2 | — | wfp/mod.rs:541 | Repeated native enumeration pages hang the service | false-positive deadline and entry bounds |
| R3-MGR-M01 | W3 | — | manager.rs:779 | Failed-child retry re-locks its own mutex | duplicate #1004 single guard spans bounded retry |
| R3-MGR-M02 | W3 | — | manager.rs:1130 | Watchdog abort kills a reused PID | duplicate #1012 cached process identity required |
| R3-MGR-M03 | W3 | — | manager.rs:947 | Restart failures never exhaust sliding budget | false-positive capped 30-second backoff reaches 11 attempts within 600-second window |
| R3-MGR-M04 | W3 | — | manager.rs:960 | Stop can leave a newly respawned child alive | false-positive stop joins/aborts watchdog and Windows Job kills entire tree |
| R3-MGR-M05 | W3 | — | manager.rs:684 | Failed IPC cleanup publishes a security identity | false-positive needs independent IPC-hardening and termination failures; app admission still requires full proof |
| WIN-DHCPV6-RELAY-SOURCE | W2 | P2 | wfp_model.rs:451 | Inbound DHCPv6 reply permits exclude legitimate non-link-local relay sources | real-unfixed decision item: safe server/service identity required before widening intentional strict permit; native Windows unrun |
| R3-WFP-DHCP-IDENTITY | W2 | — | wfp_model.rs:435 | DHCP ports have no service identity | duplicate TW-OpenAI-1 / H1-F6 |
| R3-WFP-PREFIX-OR | W2 | — | wfp_model.rs:803 | Multiple allowed DHCP prefixes are impossible conjunction | false-positive same consecutive condition fields use OR in WFP |
| R3-WFP-DUPLICATE-ENDPOINTS | W2 | — | wfp_model.rs:611 | Duplicate endpoint keys abort install | false-positive normal callers deduplicate and native engine accepts already-existing key |
| R3-WFP-UNSANITIZED-API | W2 | — | wfp_model.rs:670 | Unbounded/private API IPs become permits | false-positive facade sanitizes and caps admitted addresses |
| R3-WFP-DIRECT-WIDENING | W2 | — | wfp_model.rs:769 | Reviewed DIRECT ports allow arbitrary core destination | false-positive deliberate core-scoped capability; AI routing omission already #871 |
| R3-SEC-UNTRUSTED-OWNER | W2 | — | windows_security.rs:138 | Soft ownership error retains user control of private directory | false-positive installer validates root owner; no ordinary supported child-owner trigger proved |
| R3-SEC-OWNER-MIGRATION | W2 | — | windows_security.rs:236 | SYSTEM owner assignment failure makes migration unsafe | false-positive trusted Administrators ownership and private DACL deliberately retained |
| R3-NET-N01 | W3 | — | netmon.rs:55 | DNS write window discards real physical network change | false-positive pending callback retained and topology reconciled |
| R3-NET-N02 | W3 | — | netmon.rs:121 | Continuous notifications starve event publication | false-positive three-second max wait |
| R3-NET-N03 | W3 | — | netmon.rs:143 | Self-originated notifications cause endless reconnect | false-positive app data-plane proof preserves healthy tunnel and confirms a failure twice |
| R3-NET-N04 | W3 | — | netmon/topology.rs:102 | IPv6 default gateway changes are ignored | false-positive IPv6 default hops included and regression already covers them |
| R3-NET-N05 | W3 | — | netmon.rs:279 | Callback executes blocking native topology query | false-positive reads execute on spawn_blocking worker |
| R3-NET-N06 | W3 | — | netmon.rs:242 | Failed Notify registration permanently removes recovery | false-positive event feed degrades but independent DNS and periodic data-plane monitoring remain |
| R3-NET-N07 | W3 | — | netmon/topology.rs:54 | Source-address-only change silently loses required reconnect | false-positive native host-route behavior and need for rebuild unproved; core may redial |
| WIN-CORE-EXHAUSTION-HEALTHY-BLOCK | W3 | P2 | manager.rs:923 | Exhausted Core retries leave healthy Blocked WFP with no Core while App is unavailable | real-fixed #1032 (merged fe0f1b77); regression failed before/passed after; strict and successor-arm guards preserved |
