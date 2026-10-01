Both fixes merged through green CI. AI-hold preservation and strict-mode guards remain intact.

Paths below are relative to `apps/windows/service/src/`.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-DIRECT-EXPIRY-LIVE-CORE | Recovery | P1 | `core/windows_kill_switch.rs:3100` | DIRECT expiry releases WFP while Core retains TUN routes and native filters | Fixed in [#1074](https://github.com/raydocs/tono/pull/1074) |
| WIN-SELECTIVE-REAPPLY-GAP | AI hold | P2 | `core/selective_layer.rs:82` | Repeated apply deletes existing AI protection before reinstalling | Fixed in [#1087](https://github.com/raydocs/tono/pull/1087) |
| R4KS-OLD-WATCHDOG | Core | — | `core/manager.rs:616` | New start overwrites old watchdog | False positive: previous watchdog is joined first |
| R4KS-PID-REUSE | Core | P2 | `core/manager.rs:1146` | Cleanup targets recycled PID | Duplicate #1012; identity fencing |
| R4KS-DEAD-PID | Core | P2 | `core/manager.rs:868` | Dead PID stays published | Duplicate #999; cleared before awaits |
| R4KS-FAILED-CHILD-LOCK | Core | P1 | `core/manager.rs:772` | Recursive failed-child lock | Duplicate existing single-guard fix |
| R4KS-BOOKKEEPING | Recovery | P2 | `core/server/mod.rs:401` | Bookkeeping failure delays release | Duplicate #1021/#1032 limitation |
| R4KS-UNARMED-TOMBSTONE | Release | P2 | `core/windows_kill_switch.rs:2764` | Tombstone error skips AI disposition | Duplicate R3KS1-UNARMED-TOMBSTONE/#769 |
| R4KS-STRICT-WATCHDOG | WFP | Decision | `core/windows_kill_switch.rs:3090` | Strict watchdog releases after 30 ticks | Duplicate documented decision 027 |
| R4KS-SELECTIVE-HANG | AI hold | P2 | `core/selective_layer.rs:290` | Hung command strands worker | Duplicate #988 limitation |
| R4KS-NRPT-BYPASS | AI hold | Decision | `core/selective_fail_open.rs:36` | Cached DNS/DoH/literals bypass suffix hold | Duplicate SFO-1 design boundary |
| R4KS-LATE-HOLD | AI hold | P2 | `core/selective_layer.rs:74` | Late apply overrides Restore | Duplicate #988; revision ordering |
| R4KS-EARLY-HOLD-REMOVE | AI hold | P2 | `core/windows_kill_switch.rs:1317` | Arm removes hold before replacement | Duplicate #976; removal follows successful install |
| R4KS-SELECTIVE-LOCK | AI hold | — | `core/selective_layer.rs:83` | Lock held during native work | False positive: condition guard drops first |
| R4KS-SELECTIVE-POISON | AI hold | — | `core/selective_layer.rs:38` | Poison strands worker | False positive: poison recovery and unwind handling |
| R4KS-REVISION-OVERFLOW | AI hold | — | `core/selective_layer.rs:46` | Revision overflow crashes worker | False positive: requires approximately 2⁶⁴ requests |
| R4KS-COMMAND-INPUT | AI hold | — | `core/selective_fail_open.rs:177` | Predicate permits arbitrary commands | False positive: only fixed generators reach runner |
| R4KS-NRPT-COLLATERAL | AI hold | — | `core/selective_fail_open.rs:75` | NRPT blocks general/LAN domains | False positive: fixed suffixes exclude catch-all |
| R4KS-UNWANTED-STARTUP | Startup | — | `core/windows_kill_switch.rs:3305` | Startup erases crash hold | False positive: hold is preserved |
| R4KS-IDLE-STOP | AI hold | — | `core/windows_kill_switch.rs:3007` | Idle SCM Stop erases hold | False positive: `None` preserves disposition |
| R4KS-NRPT-GUID | AI hold | — | `core/dns/engine.rs:1888` | Selective GUID collides with catch-all | False positive: separate GUIDs and guard |
| R4KS-WFP-FLOOR-KEY | WFP | — | `core/wfp_model.rs:57` | Upgrade retains old filter body | False positive: namespace bumped to v12 |
| R4KS-WFP-POINTER | WFP | — | `core/wfp/mod.rs:860` | Container movement invalidates FFI pointers | False positive: boxed values retain addresses |
| R4KS-WFP-PERSISTENCE | WFP | — | `core/wfp/mod.rs:854` | Floor permits survive handle close | False positive: deliberate DHCP/loopback/NDP floor |
| R4KS-GENERIC-LIVE-CORE | Recovery | P2 | `core/windows_kill_switch.rs:3127` | Generic fallback may retain Core routing | Duplicate W1-LIVE-CORE-RELEASE; teardown remains unresolved |
| R4KS-DURABLE-AI-INTENT | AI hold | P2 | `core/windows_kill_switch.rs:2799` | Release loses AI disposition across Service death | Duplicate issue #1077 |
| R4KS-LATE-DIRECT-BEGIN | Recovery | — | `core/windows_kill_switch.rs:2309` | Late Begin cancels retirement | False positive: pending deadline survives; Lock denied |
| R4KS-OWNER-STARTUP-SPLIT | Startup | P2 | `core/windows_kill_switch.rs:3534` | Interrupted takeover leaves mismatched owners and Blocked | Duplicate W1-UNVERIFIED-OWNER-RETIRE; ownership decision required |
| R4KS-NETSH-SYSTEMROOT | AI hold | P2 | `core/selective_fail_open.rs:106` | Hard-coded netsh path fails on another system drive | Duplicate issue #1085 |

- **#1074:** merged; `needs-hardware`; merge-commit auto-merge completed.
- **#1087:** merged; `needs-hardware`; merge-commit auto-merge completed.

Both new regressions failed before their fixes and passed afterward. Relevant Linux suites and all required Windows CI checks passed.

**29 hypotheses examined: two fixed, 13 false positives, 14 duplicates/known decisions.** All four assigned files and relevant callers were audited. Installed-device network and packet acceptance remains unrun.

[Final report and receipts](/workspace/w1-codex/out/R4-KSdeep/report.md)

Hunter: GPT-6.1 Sol (Codex CLI)