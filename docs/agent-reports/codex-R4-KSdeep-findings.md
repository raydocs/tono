# R4-KSdeep: Codex (GPT-6.1 Sol) findings

Generated 2026-09-30 23:23 MT from the run's findings.tsv / prs.tsv.

## PRs

| PR | Branch | Labels | Auto-merge requested | Title |
|---|---|---|---|---|
| 1074 | hunt/sol-r4ks-watchdog-core-retirement | needs-hardware | yes | fix(windows): retire Core before committed DIRECT fallback |
| 1087 | hunt/sol-r4ks-selective-reapply | needs-hardware | yes | fix(windows): refresh the selective AI hold in place |

## Hypotheses

| ID | Area | Sev | Location | Description | Verdict |
|---|---|---|---|---|---|
| R4KS-OLD-WATCHDOG | Windows Core | — | manager.rs:616 | New start overwrites old watchdog during recovery | false-positive StartClash unconditionally joins previous watchdog before start |
| R4KS-PID-REUSE | Windows Core | P2 | manager.rs:1146 | Watchdog cleanup targets recycled PID | duplicate #1012 cached identity fences fallback |
| R4KS-DEAD-PID | Windows Core | P2 | manager.rs:868 | Confirmed-dead PID remains published during cleanup | duplicate #999 PID clears before awaits |
| R4KS-FAILED-CHILD-LOCK | Windows Core | P1 | manager.rs:772 | Tracked child cleanup recursively locks failed_child | duplicate existing one-guard fix |
| R4KS-BOOKKEEPING | Windows recovery | P2 | server/mod.rs:401 | Core retirement bookkeeping failure delays broad release | duplicate #1021/#1032 cleanup-failure limitation |
| R4KS-UNARMED-TOMBSTONE | Windows release | P2 | windows_kill_switch.rs:2764 | Unarmed tombstone error skips requested AI disposition | duplicate R3KS1-UNARMED-TOMBSTONE known #769 limitation |
| R4KS-STRICT-WATCHDOG | Windows WFP | decision | windows_kill_switch.rs:3090 | Strict unhealthy watchdog releases after 30 ticks | duplicate documented decision 027; not changed |
| R4KS-SELECTIVE-HANG | Windows AI hold | P2 | selective_layer.rs:290 | Hung native command strands reconciler | duplicate R3KS1-SELECTIVE-WORKER-HANG #988 limitation |
| R4KS-NRPT-BYPASS | Windows AI hold | decision | selective_fail_open.rs:36 | Cached DNS DoH or literals bypass suffix hold | duplicate SFO-1 accepted-design boundary |
| R4KS-LATE-HOLD | Windows AI hold | P2 | selective_layer.rs:74 | Late apply overrides newer Restore | duplicate #988 revisioned worker |
| R4KS-EARLY-HOLD-REMOVE | Windows AI hold | P2 | windows_kill_switch.rs:1317 | Arm removes hold before replacement barrier exists | duplicate #976 removal follows exact successful install |
| R4KS-SELECTIVE-LOCK | Windows AI hold | — | selective_layer.rs:83 | Worker lock held through native application | false-positive temporary condition guard drops before body |
| R4KS-SELECTIVE-POISON | Windows AI hold | — | selective_layer.rs:38 | Poison strands hold worker | false-positive guard recovers poison; unwind resets worker |
| R4KS-REVISION-OVERFLOW | Windows AI hold | — | selective_layer.rs:46 | Revision overflow crashes worker | false-positive requires approximately 2^64 requests |
| R4KS-COMMAND-INPUT | Windows AI hold | — | selective_fail_open.rs:177 | Permissive command predicate executes arbitrary input | false-positive only fixed generated commands reach runner |
| R4KS-NRPT-COLLATERAL | Windows AI hold | — | selective_fail_open.rs:75 | NRPT blocks general or LAN domains | false-positive fixed first-party suffixes and separate GUIDs exclude catch-all |
| R4KS-UNWANTED-STARTUP | Windows AI hold | — | windows_kill_switch.rs:3305 | Unwanted startup erases crash AI hold | false-positive startup preserves hold |
| R4KS-IDLE-STOP | Windows AI hold | — | windows_kill_switch.rs:3007 | Idle SCM Stop erases crash AI hold | false-positive idle passes None preserving disposition |
| R4KS-NRPT-GUID | Windows AI hold | — | dns/engine.rs:1888 | Selective GUID collides with catch-all | false-positive fixed separate GUIDs plus install guard |
| R4KS-WFP-FLOOR-KEY | Windows WFP | — | wfp_model.rs:57 | Same stable keys retain old filter body on upgrade | false-positive filter namespace bumped to v12 |
| R4KS-WFP-POINTER | Windows WFP | — | wfp/mod.rs:860 | Moving condition containers invalidates FFI pointers | false-positive boxed values stay heap-pinned |
| R4KS-WFP-PERSISTENCE | Windows WFP | — | wfp/mod.rs:854 | Persistent floor permits survive handle close | false-positive deliberate recoverable floor includes DHCP/loopback/NDP |
| WIN-DIRECT-EXPIRY-LIVE-CORE | Windows recovery | P1 | windows_kill_switch.rs:3100 | Automatic broad release leaves TUN Core and its native strict-route filters alive | real-fixed #1074 |
| WIN-SELECTIVE-REAPPLY-GAP | Windows AI hold | P2 | selective_layer.rs:82 | Repeated apply deletes existing AI hold before reapplying | real-fixed #1087 |
| R4KS-GENERIC-LIVE-CORE | Windows recovery | P2 | windows_kill_switch.rs:3127 | Generic WFP-only fallback may retain Core routes and DNS hijack | duplicate W1-LIVE-CORE-RELEASE; safe teardown without a new install dependency remains unresolved |
| R4KS-DURABLE-AI-INTENT | Windows AI hold | P2 | windows_kill_switch.rs:2799 | Automatic release can lose AI disposition across Service death | duplicate issue #1077; another hunter verified and owns reporting |
