| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-FRESH-ARM-RETIRE-BOOKKEEPING | After abandoned Connect, Core recovery exhaustion or committed DIRECT expiry, `retire_expired_fresh_arm` stopped the Core but refused the release on a repair-gate I/O error or a failed run-intent read/write, every watchdog tick, so a non-strict machine stayed Blocked | in-PR | #1275 | 中·推导（P2，源码与回归） | Not reproduced on hardware (needs-hardware); CI runs the regression |

Found in the round-3 Windows Service hunt (main `10ce26c9`). Same class as WIN-SCM-RETIREMENT-FAILURE-RELEASE (SCM Stop) and
H-IPC-2 (stop gate I/O): a persistent ProgramData ACL or AV-handle failure repeats every tick. The fix keeps the Core-stop
proof, the installer-held gate and update admission as refusals, logs a gate I/O error or a run-intent bookkeeping failure,
and still releases with the AI hold. `restore_desired_state` refuses to replay a Core without a wanted barrier, so the
release's wanted:false tombstone fences the unretired run intent. Regression:
`fresh_arm_expiry_releases_when_the_run_intent_cannot_be_retired`.
