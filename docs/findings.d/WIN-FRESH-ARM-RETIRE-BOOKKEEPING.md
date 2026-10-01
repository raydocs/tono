| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-FRESH-ARM-RETIRE-BOOKKEEPING | After abandoned Connect, Core recovery exhaustion or committed DIRECT expiry, `retire_expired_fresh_arm` stopped the Core but refused the release on a repair-gate I/O error or a failed run-intent read/write, every watchdog tick, so a non-strict machine stayed Blocked | in-PR | #1275 | 中·推导（P2，源码与回归） | Not reproduced on hardware (needs-hardware); CI runs the regression |

Found in the round-3 Windows Service hunt (main `10ce26c9`). Same class as WIN-SCM-RETIREMENT-FAILURE-RELEASE (SCM Stop) and
H-IPC-2 (stop gate I/O): a persistent ProgramData ACL or AV-handle failure repeats every tick. The fix keeps the Core-stop
proof, the installer-held gate and update admission as refusals, logs a gate I/O error or a run-intent bookkeeping failure,
and still releases with the AI hold. `restore_desired_state` refuses to replay a Core without a wanted barrier, so the
release's wanted:false tombstone fences the unretired run intent. Regression:
`fresh_arm_expiry_releases_when_the_run_intent_cannot_be_retired`.

2026-10-01 review round (Codex gpt-6.1-sol high at `6bc359cb`: no blocker/major, one minor). Replay fencing no longer rests on the tombstone alone: `retire_abandoned_run_intent` clears the active owner even when the run-intent write fails, and `release_unproven_wanted_session_unlocked` removes the stale wanted record when its tombstone write fails (the pending retry still writes the tombstone). Residual: all three writes failing, or a crash before the release writes anything, can still leave a same-boot replay. The regression now covers the same-boot restart.
