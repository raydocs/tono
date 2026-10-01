| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R3REGW-FRESH-ARM-READBACK | A reconnect's inherited verification can falsely acknowledge an undelivered MarkVerified and leave the fresh Connect deadline active | in-PR | branch `hunt/sol-r3regw-fresh-arm-proof` | 中·已确认（P1，production Service regression on Linux） | Native Windows/Tauri and installed WFP/DNS behavior require CI and hardware; Linux tests simulate filters. |

Regression interaction with #1021 on baseline `f7d82d30`: `arm_bootstrap` retains same-owner durable verification, while creating a new fresh-proof deadline. A MarkVerified transport failure before Service dispatch reaches the App's status readback (`apps/windows/app/src-tauri/src/core/service/mod.rs:1150`). Locked/live/tunnel-permitted status still carried predecessor `verified=true`, satisfying `mark_verified_committed` without clearing the fresh deadline. Seven minutes later the watchdog retires the healthy connection. One failed IPC request is sufficient; no crash or second independent failure is required.

Status now withholds current-attempt verification while fresh proof is pending. Durable intent inheritance and startup recovery remain intact. Actual MarkVerified clears pending, including its idempotent inherited-proof branch, so a lost response after commit still has authoritative readback. Strict protection is unaffected.

The new narrow regression uses actual arm, lock, status and mark methods: prior proof retained durably, new readback unverified until a new mark, then verified with deadline cleared. Before the status fix: 0 passed, 1 failed at the inherited-readback assertion. Native liveness is deliberately not claimed by the test facade.
