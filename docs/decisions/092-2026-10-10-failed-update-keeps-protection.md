## 2026-10-10 · macOS: does a failed native-update executor run (or helper start) release PF and DNS?
- Status: owner (owner approved 2026-10-11 via Puck, on condition that the acceptance criteria below are proven;
  092 is not closed until they are)
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
  and an A29 protected fault stay and the start fails, so launchd retries it. The later daemon start (bound uid,
  server construction) follows the same authority for both its PF release and its DNS restore (round 8, R7-F2):
  `secureFailedStartupRestoringDNS` releases only on an operator `released` or no saved protection, and the
  saved-block release itself refuses an unreadable target.
- Same rule for an abandoned app-side helper replacement (round 8, #1071): a prompt-free preparation keeps
  protected DNS and its snapshot with or without an A29 fault, and an upgrade that stopped the Core and then did
  not replace the daemon (administrator prompt cancelled, install failed, prompt withheld) releases nothing: PF,
  the armed intent and protected DNS stay, the install error surfaces, and the user's Disconnect or Restore
  internet (served by the old helper, still running) is the only release. With the administrator prompt (Connect
  or Restore internet asked for it) DNS is still restored before the replacement, as before; PF stays. #1071:
  fixed-code / pending-hardware; device gate: cancel the administrator prompt during an upgrade, protection stays
  on, Restore internet recovers.
- Owner ruling 2026-10-11 (Puck): 092 covers helper replacement / upgrade failure too (#1071), and one-click release
  is a release **hard gate**: one explicit user action, with at most one risk confirmation, runs a bounded local
  recovery that needs no account, API, tunnel or relay; works with the current and the previous helper (repair
  first, never a blind call to an endpoint the old helper may lack); cancels the matching reconnect and update work
  and retires their generation; never leaves the UI waiting forever; reports released / partially failed / unknown
  and never fakes success; restores PF, DNS **and** the AI sinkholes and blackhole routes (sites working while AI
  stays blocked is a failure); and on failure points to the local emergency exit. Test matrix: #1504 PR body;
  device steps: owner checklist G1 step 6. "Never waiting forever" is a 60 s UI deadline: past it the UI stops
  waiting and shows "unknown, still finishing" with the recovery command. It is not a promise that recovery completes
  in 60 s; the drain before the release has no cap, and the post-drain budget is in the PR body. The real release
  and its PF/DNS/AI readback are device-gated. The release itself is not yet bounded (round 9): the helper has no
  user-release fence and serves one request at a time. Blocker and minimal option are in the #1504 PR body; the
  hard gate stays open until the owner decides. Emergency entry: the in-app Support page shows
  `--emergency-reset` (helper removal; with a pending update it falls back to the older release without readback);
  the bounded, read-back command is `--emergency-disarm`. Both run from Terminal as root without the app.
- In short: an automatic failure keeps the whole protection (PF, intent, protected DNS, an A29 fault); only an
  explicit Restore / Disconnect or an operator release releases.
- Release authority, the same everywhere (decision 084 round 7): an operator `released` on record, the user's own
  Disconnect (here: the attempt's), the user's Restore Internet, or no saved protection. An unreadable target is
  unknown and is never authority.
- Why stricter: a protected Mac never loses its block or protected DNS because a helper step failed or timed out.
  The cost is availability: a persistently failing executor, or a helper start that keeps failing (the app cannot
  reach a helper to Disconnect then), keeps the Mac offline until a retry succeeds or an
  administrator runs `sudo /Library/PrivilegedHelperTools/tono-core-helper --emergency-disarm`, whose `released`
  target this path obeys.
- Acceptance criteria (the owner's condition):
  1. **Explicit Restore always works.** Turning protection off / restoring normal internet does not depend on sign-in,
     the API or a healthy tunnel, and still works after an update Prepare or Execute failure, a startup or IPC
     timeout, an abnormal helper state or a helper restart, through a bounded local path: the app's explicit
     disarm (`/killswitch/disarm`, or `/update/disconnect` while an update is pending), or
     `--emergency-disarm` when the helper is unresponsive. The user is shown and confirms the risk; success means
     a real PF / DNS readback; an unknown result never claims protection was released.
  2. **Automatic paths never silently release**, and an explicit release is never undone: an older generation does
     not re-lock after the user releases; the release stops the matching reconnect and update work; no late write
     re-installs the block.
  3. **Regressions**, one per branch (normal, update Prepare failure, Execute failure, startup / IPC timeout, helper
     restart), each showing the explicit release succeeds and is not undone; what cannot run in CI is a device gate.
     Mapping and device steps: #1504 PR body and
     [owner checklist G1 step 5](../ops/release-0075-owner-g1-g2-checklist.md).
  Status of the criteria: code-pending until the #1504 regressions pass in hosted CI **and** the independent review
  (Sol) passes the head that carries them; device-pending until G1 step 5 is done on a real Mac.
- Applied in: [#1504](https://github.com/raydocs/tono/pull/1504) (backlog A13, helper 4.52.50).
