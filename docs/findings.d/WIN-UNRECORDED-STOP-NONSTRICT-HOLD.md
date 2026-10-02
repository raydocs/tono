| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UNRECORDED-STOP-NONSTRICT-HOLD | A kept `StopClash` whose stop could not be recorded and whose Core could not be restarted left a verified non-strict session Blocked with no Core, no watchdog and no deadline; only the App's next failed Connect released it | in-PR | #1139 / #1327 | 高·推导（P1，源码与回归） | Not reproduced on hardware (needs-hardware); the release waits for the 1 s WFP watchdog tick |

Reported by Codex on main `9947450e`. #1295 already let the App's explicit release through after a bookkeeping failure, which closed the
App-driven half. The Service-side half stayed: with the App gone or stuck after the failed stop, nothing opened the barrier. The fix
queues the same epoch-fenced retirement an exhausted Core watchdog queues (`note_core_recovery_exhausted` → `retire_expired_fresh_arm`):
run intent retired (write failure tolerated, replay fenced as in #1275), general traffic opened, AI hold kept. Strict is unchanged.
Regression: `an_unrecorded_stop_that_cannot_restart_queues_the_selective_release`.
