| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-QUIT-STALE-RESYNC | A cancelled-quit Service response can erase a newer connection's FSM and protection evidence | fixed(718eda43) | hunt/sol-r4wapp-quit-resync-generation | 低·已确认（P2） | Deterministic production-fold/real-FSM regression failed then passed on Linux; native Windows/Tauri and installed lifecycle behavior await CI/hardware. |

Baseline `42775907`: `commands/quit.rs:427-437` applies the status read without a connection-generation fence. A disarmed snapshot sampled before successor admission can arrive after the successor becomes Connected, causing `apply_service_kill_switch` to clear its FSM at `:539-543`. The health monitor then exits because it no longer sees Connected. The existing protection-resync monitor already checks the generation; the cancelled-quit/update caller omitted that fence.

The response fold is now conditional on the generation captured before I/O. Current-state monitor setup, status emission and cancelled-exit catalog restart still run when the old response is discarded.
