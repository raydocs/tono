| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RELEASE-ROUTE-BOOKKEEPING | The explicit `ReleaseKillSwitch` route stopped the Core, then refused the release when only the run-intent or active-owner write failed, on every retry, so a non-strict machine stayed Blocked until the elevated Restore Network shortcut | fixed(8a91ee51) | #1274 | 中·推导（P2，源码与回归） | Not reproduced on hardware (needs-hardware); CI runs the regression |

Found in the round-3 Windows Service hunt (main `10ce26c9`). Same class as WIN-FRESH-ARM-RETIRE-BOOKKEEPING (automatic path, #1275)
and WIN-SCM-RETIREMENT-FAILURE-RELEASE (SCM Stop). The fix keeps the refusal for an unconfirmed Core stop, a readable foreign owner
record and an unproven DNS restore; a bookkeeping failure after a confirmed stop is logged (`release_despite_bookkeeping`) and the
route releases. Replay stays fenced: `rollback_started_owner` clears the active owner independently of the run-intent write, the
unrecorded path has no readable owner, and the release writes a wanted:false tombstone or removes the wanted intent, without which
`restore_desired_state` starts nothing. Residual (same as #1275): all of those writes failing can still leave a same-boot replay.
Regression: `explicit_release_proceeds_when_the_run_intent_cannot_be_retired`.
