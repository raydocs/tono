Merged [#1032](https://github.com/raydocs/tono/pull/1032): exhausted Core recovery now releases non-strict protection through the existing AI-hold fallback. Strict mode and replacement-session guards remain intact. No new P0/P1 bugs were verified.

Paths below are relative to `apps/windows/service/src/core`; line numbers identify the audited baseline.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-CORE-EXHAUSTION-HEALTHY-BLOCK | W3 | P2 | manager.rs:923 | Exhausted retries leave Blocked WFP without a Core when App recovery is unavailable | **Fixed in #1032** |
| WIN-DHCPV6-RELAY-SOURCE | W2 | P2 | wfp_model.rs:451 | Legitimate non-link-local DHCPv6 relay replies are rejected | **Real-unfixed:** widening the intentional permit needs an identity-scoped design; [relay behavior documented](https://help.mikrotik.com/docs/spaces/ROS/pages/48660574/Filter) |
| R3-WFP-N01 | W2 | — | wfp/mod.rs:148 | Filters survive Service exit | False positive: deliberate persistence with reconciliation |
| R3-WFP-N02 | W2 | — | wfp/mod.rs:437 | Reboot loses infrastructure permits | Duplicate of #753 |
| R3-WFP-N03 | W2 | — | wfp/mod.rs:975 | Residual provider blocks traffic | False positive: inert without filters |
| R3-WFP-N04 | W2 | — | wfp/mod.rs:175 | Transaction errors skip abort | False positive: both error paths explicitly abort |
| R3-WFP-N05 | W2 | — | wfp/mod.rs:166 | Unwind strands transaction | False positive: session closure aborts it; [Microsoft documentation](https://learn.microsoft.com/en-us/windows/win32/fwp/object-management) |
| R3-WFP-N06 | W2 | — | wfp/mod.rs:255 | Vector movement invalidates native pointers | False positive: boxed pointees remain stable |
| R3-WFP-N07 | W2 | — | wfp/mod.rs:876 | Verification accepts stale DIRECT filters | False positive: exact provider key-set comparison |
| R3-WFP-N08 | W2 | — | wfp_model.rs:617 | Moved executable inherits permit | False positive: paths participate in filter keys |
| R3-WFP-N09 | W2 | — | wfp/mod.rs:1040 | Tunnel alias admits physical/absent interface | Duplicate of #676 |
| R3-WFP-N10 | W2 | — | wfp/mod.rs:341 | NDP condition uses incorrect field | False positive: documented ICMP field alias |
| R3-WFP-N11 | W2 | — | wfp_model.rs:606 | Existing flows bypass removed permits | False positive: policy changes trigger [ALE reauthorization](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-re-authorization) |
| R3-WFP-N12 | W2 | — | wfp/mod.rs:1011 | Emergency cleanup erases replacement policy | False positive: owner coordination and fallback proof |
| R3-WFP-N13 | W2 | — | wfp/mod.rs:922 | Unresolved app identity removes protection | False positive: block installs without unresolved permits |
| R3-WFP-N14 | W2 | — | wfp/mod.rs:541 | Repeated enumeration hangs Service | False positive: deadline and entry bounds |
| R3-MGR-M01 | W3 | — | manager.rs:779 | Failed-child retry locks itself | Duplicate of #1004 |
| R3-MGR-M02 | W3 | — | manager.rs:1130 | Abort kills reused PID | Duplicate of #1012 |
| R3-MGR-M03 | W3 | — | manager.rs:947 | Backoff prevents budget exhaustion | False positive: capped backoff reaches exhaustion within window |
| R3-MGR-M04 | W3 | — | manager.rs:960 | Stop leaves respawned child alive | False positive: watchdog termination plus Windows Job cleanup |
| R3-MGR-M05 | W3 | — | manager.rs:684 | Failed cleanup publishes unsafe identity | False positive: requires independent failures; App admission still requires proof |
| R3-WFP-DHCP-IDENTITY | W2 | — | wfp_model.rs:435 | DHCP permits lack service identity | Duplicate of TW-OpenAI-1 / H1-F6 |
| R3-WFP-PREFIX-OR | W2 | — | wfp_model.rs:803 | DHCP prefixes become impossible conjunction | False positive: repeated condition fields use OR |
| R3-WFP-DUPLICATE-ENDPOINTS | W2 | — | wfp_model.rs:611 | Duplicate endpoints abort installation | False positive: callers deduplicate; existing keys are handled |
| R3-WFP-UNSANITIZED-API | W2 | — | wfp_model.rs:670 | Private/unbounded API addresses become permits | False positive: facade sanitizes and caps addresses |
| R3-WFP-DIRECT-WIDENING | W2 | — | wfp_model.rs:769 | DIRECT capability admits arbitrary destinations | False positive: deliberate Core capability; AI omission already #871 |
| R3-SEC-UNTRUSTED-OWNER | W2 | — | windows_security.rs:138 | Ownership error retains user-controlled directory | False positive: installer validates root owner; ordinary trigger unproved |
| R3-SEC-OWNER-MIGRATION | W2 | — | windows_security.rs:236 | Failed SYSTEM ownership migration is unsafe | False positive: trusted Administrators owner and private DACL remain |
| R3-NET-N01 | W3 | — | netmon.rs:55 | DNS-write window loses network change | False positive: pending callback and topology reconciliation |
| R3-NET-N02 | W3 | — | netmon.rs:121 | Notifications starve publication | False positive: three-second maximum wait |
| R3-NET-N03 | W3 | — | netmon.rs:143 | Self-notifications cause reconnect loop | False positive: healthy data-plane proof suppresses reconnect |
| R3-NET-N04 | W3 | — | netmon/topology.rs:102 | IPv6 gateway changes are ignored | False positive: included and already regression-tested |
| R3-NET-N05 | W3 | — | netmon.rs:279 | Callback blocks on topology query | False positive: query runs through `spawn_blocking` |
| R3-NET-N06 | W3 | — | netmon.rs:242 | Registration failure eliminates recovery | False positive: independent DNS/data-plane monitoring remains |
| R3-NET-N07 | W3 | — | netmon/topology.rs:54 | Address-only changes require missed reconnect | False positive: required rebuild unproved; Core can redial |

PR **#1032** has `needs-hardware`, used auto-merge with a **merge commit**, and merged as `fe0f1b77`. CI gate and all relevant Windows jobs passed. The regression failed before the fix and passed afterward; local WFP tests passed **104/104**, manager tests **9/9**.

Examined **35 hypotheses**: **28 false positives, 5 duplicates, 1 fixed, 1 decision item**. Assigned-file and cross-call audits are complete. Physical Windows WFP/DNS/DHCPv6, adapter/sleep, and installed-Service acceptance remain untested here; the DHCPv6 identity design remains unresolved.

Artifacts: [full report](/workspace/w1-codex/out/R3-W2W3/report.md), [findings.tsv](/workspace/w1-codex/out/R3-W2W3/findings.tsv), [prs.tsv](/workspace/w1-codex/out/R3-W2W3/prs.tsv).