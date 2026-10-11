## 2026-10-10 · macOS: does a failed native-update executor run (or helper start) release PF and DNS?
- Status: provisional
- Chosen: the failed run keeps the installed block and protected DNS unless there is an explicit release intent: an
  operator release on record (`target-state` = `released`), the update attempt's own Disconnect, or no saved
  protection at all (`killswitch.state` definitely absent). A failure, a timeout, a launch with no answer, or a
  reading that cannot be made is not one. A blocked consumed attempt still starts the daemon (it restores saved
  protection); an interrupted replacement or rollback exits failed so launchd reruns the executor (`KeepAlive`).
  Rejected: releasing on every failure (the BRICK-M8 fix), because a bounded `launchctl bootstrap` or successor
  `open` that only ran out of time released a protected update while the daemon may already be starting (#1504
  review R5-F3).
- Same rule at helper start (round 7, R6-F3): when the daemon's `UpdateExecutor.startup` fails (a corrupt ledger, or
  relaunching a consumed attempt's executor where the bounded `launchctl bootstrap` and then `print` both time out),
  `settleStartupFailure` (formerly `armEmergencyBlock`, which released PF and DNS and applied the AI layer
  unconditionally) releases only under the same release authority; the attempt's Disconnect is the one read under
  the lock startup already holds, unknown when it could not be read. Otherwise the block, its intent, protected DNS
  and an A29 protected fault stay and the start fails, so launchd retries it.
- Release authority, the same everywhere (decision 084 round 7): an operator `released` on record, the user's own
  Disconnect (here: the attempt's), the user's Restore Internet, or no saved protection. An unreadable target is
  unknown and is never authority.
- Why stricter: a protected Mac never loses its block or protected DNS because a helper step failed or timed out.
  The cost is availability: a persistently failing executor, or a helper start that keeps failing (the app cannot
  reach a helper to Disconnect then), keeps the Mac offline until a retry succeeds or an
  administrator runs `sudo /Library/PrivilegedHelperTools/tono-core-helper --emergency-disarm`, whose `released`
  target this path obeys.
- Applied in: [#1504](https://github.com/raydocs/tono/pull/1504) (backlog A13, helper 4.52.50).
