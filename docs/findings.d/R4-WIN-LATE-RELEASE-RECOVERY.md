| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-LATE-RELEASE-RECOVERY | Successful automatic Windows release after the 55-second UI wait loses its unarmed recovery continuation | in-PR | branch hunt/sol-r4fws-late-release-recovery | 中·已确认（P2，Linux 边界回归） | Exact coordinator/operation/FSM regression fails before and passes after; Windows/Tauri and real WFP/DNS timing require CI/hardware. |

Baseline 6ba79f61, connection/disconnect.rs:62 and connection/monitor.rs:1443-1457: ordinary health cleanup uses the explicit UI waiter. A release that succeeds at 56 seconds returns a timeout to the health owner at 55; it ends without starting the unarmed probe. Detached settlement restores ordinary traffic with the AI hold, but the successful idle state is not watched by protection resync. Await the actual supervised result for automatic narrow cleanup; keep explicit UI budgets, native IPC bounds, strict disposition and AI hold unchanged.
