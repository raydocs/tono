All five fixes merged through green CI.

A supplementary #976 body edit failed twice because `gh` queried GitHub’s retired Projects Classic field. Code is merged. Branch: `hunt/sol-r3ks-arm-ai-hold`; title: “fix(windows): preserve the AI hold when WFP install fails”; [saved body](/workspace/w1-codex/out/R3-W1hi/arm-ai-pr-body.md).

Paths below are relative to `apps/windows/service/src`; lines refer to audited baselines.

| ID | Area | Severity | File:line | Description | Verdict |
|---|---|---|---|---|---|
| WIN-RECOVERY-AI-HOLD-OMISSION | WFP | P1 | core/windows_kill_switch.rs:2946 | Recovery omitted secondary AI hold | Fixed in #974 |
| WIN-UPDATE-FAILURE-AI-HOLD | Update | P1 | bin/install_service/update_executor.rs:586 | Failed-update release removed AI hold | Fixed in #978 |
| WIN-FAILED-ARM-AI-HOLD | WFP | P2 | core/windows_kill_switch.rs:1216 | Failed installation removed existing AI hold | Fixed in #976 |
| WIN-STARTUP-RETRY-RECONNECT | WFP | P2 | core/windows_kill_switch.rs:513 | Cleanup retry deleted reconnect intent | Fixed in #986 |
| WIN-SELECTIVE-LATE-WORKER | WFP | P2 | core/selective_layer.rs:24 | Late native work overwrote newer protection state | Fixed in #988 |
| W1-LIVE-CORE-RELEASE | WFP | P2? | core/windows_kill_switch.rs:2737 | Surviving broken TUN might retain bad routes | Unverified; native route proof needed |
| W1-UNWANTED-UNLINK-DNS | WFP/DNS | P2? | core/windows_kill_switch.rs:3138 | Intent unlink error skips DNS cleanup | Unverified; harm requires two failures |
| W1-DIRECT-EXPIRY | WFP | P1 | core/windows_kill_switch.rs:3428 | Expired DIRECT lease retains Blocked policy | Duplicate #777/#926 |
| W1-WANTED-NO-CORE | WFP | P1 | core/windows_kill_switch.rs:2800 | Restored block outlives Core | Duplicate #740 |
| W1-LOCK-POISON | WFP | P2 | core/windows_kill_switch.rs:1910 | Poisoned ARMED lock panics IPC | Duplicate #812 |
| W1-UNVERIFIED-OWNER-RETIRE | WFP | P2 | core/windows_kill_switch.rs:3349 | Failed owner retirement retains protection | Duplicate documented #777 limitation |
| W1-RESTORED-RELOCK | WFP | P1 | core/windows_kill_switch.rs:3386 | Failed relock consumes retry flag | Duplicate; #740 bounds recovery |
| W1-UPDATE-TOMBSTONE | Update | P2 | bin/install_service/update_executor.rs:586 | Failed checkpoint can refuse update release | Duplicate #858 limitation |
| W1-PERSISTENT-PERMITS | Model | P1 | core/wfp_model.rs:287 | Infrastructure permits disappear before deny | Duplicate #753 |
| W1-STATUS-MIXED | Status | P2 | core/status.rs:47 | Status combines separate samples | Duplicate F520-1 |
| W1-INHERITED-CORE-WINDOW | WFP | P2 | core/windows_kill_switch.rs:299 | Replacement inherits proof deadline | Duplicate #740; no distinct trigger proved |
| W1-LATE-INTENT-RENAME | WFP | P2 | core/windows_kill_switch.rs:639 | Late rename overwrites successor intent | Duplicate BRICK-W11 |
| W1-RECOVERY-CHECKPOINT | WFP | P2 | core/windows_kill_switch.rs:2745 | Slow AI hold extends checkpoint window | Duplicate; #740 recovery guards remain |
| W1-STRICT-UNHEALTHY | WFP | — | core/windows_kill_switch.rs:2918 | Strict watchdog recovery appears inconsistent | False positive; documented #733 behavior |
| W1-DHCP-PERMIT | Model | — | core/wfp_model.rs:442 | Infrastructure permits might bypass AI blocking | False positive; bounded exceptions, no bypass proved |
| W1-FFI-VALUES | FFI | — | core/wfp/mod.rs:260 | Vector growth might invalidate pointers | False positive; values remain heap-pinned |
| W1-EMERGENCY-TOMBSTONE | WFP | — | core/windows_kill_switch.rs:3665 | Checkpoint failure might prevent Restore | False positive; supported recovery uses tolerant ladder |
| W1-REPLACEMENT-CORRUPT-OWNER | WFP | — | core/windows_kill_switch.rs:3270 | Replacement preserves corrupt evidence | False positive; startup performs recovery |
| W1-EMERGENCY-LIVE-SERVICE | Service | — | bin/service.rs:135 | Recovery CLI races healthy service | False positive; singleton owner gate prevents it |
| W1-ASYNC-LOCK-CYCLE | WFP | — | core/windows_kill_switch.rs:125 | Watchdog waits behind lifecycle locks | False positive; coherent atomic Core identity |
| W1-DETACHED-ENGINE-OVERLAP | WFP | — | core/windows_kill_switch.rs:951 | Timed-out WFP workers overlap | False positive; worker retains engine claim |
| W1-EMERGENCY-SWEEP-HANG | WFP/DNS | — | core/windows_kill_switch.rs:3730 | Resolver sweep hangs service indefinitely | False positive; bounded, isolated recovery CLI |
| W1-EMERGENCY-PROCESS-FLAGS | WFP | — | core/windows_kill_switch.rs:3690 | Recovery leaves stale watchdog flags | False positive; isolated process exits |

| PR | Status | Auto-merge | Labels |
|---|---|---|---|
| [#974](https://github.com/raydocs/tono/pull/974) | Merged | MERGE enabled | needs-hardware |
| [#976](https://github.com/raydocs/tono/pull/976) | Merged | MERGE enabled | needs-hardware |
| [#978](https://github.com/raydocs/tono/pull/978) | Merged | MERGE enabled | needs-hardware |
| [#986](https://github.com/raydocs/tono/pull/986) | Merged | MERGE enabled | needs-hardware |
| [#988](https://github.com/raydocs/tono/pull/988) | Merged | MERGE enabled | needs-hardware |

**28 hypotheses examined:** five fixed, eleven duplicates, **ten false positives**, two unverified. Every fix has failing-before/passing-after regression evidence; all five merge commits are present in `origin/main`.

Assigned source review is complete. Real-device networking checks and proof of the two unverified DNS/TUN scenarios remain unfinished. [Full report](/workspace/w1-codex/out/R3-W1hi/REPORT.md).