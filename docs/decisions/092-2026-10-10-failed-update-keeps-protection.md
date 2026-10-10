## 2026-10-10 · macOS: does a failed native-update executor run release PF and DNS?
- Status: provisional
- Chosen: the failed run keeps the installed block and protected DNS unless there is an explicit release intent: an
  operator release on record (`target-state` = `released`), the update attempt's own Disconnect, or no saved
  protection at all (`killswitch.state` definitely absent). A failure, a timeout, a launch with no answer, or a
  reading that cannot be made is not one. A blocked consumed attempt still starts the daemon (it restores saved
  protection); an interrupted replacement or rollback exits failed so launchd reruns the executor (`KeepAlive`).
  Rejected: releasing on every failure (the BRICK-M8 fix), because a bounded `launchctl bootstrap` or successor
  `open` that only ran out of time released a protected update while the daemon may already be starting (#1504
  review R5-F3).
- Why stricter: a protected Mac never loses its block or protected DNS because a helper step failed or timed out.
  The cost is availability: a persistently failing executor keeps the Mac offline until a retry succeeds or an
  administrator runs `sudo /Library/PrivilegedHelperTools/tono-core-helper --emergency-disarm`, whose `released`
  target this path obeys.
- Applied in: [#1504](https://github.com/raydocs/tono/pull/1504) (backlog A13, helper 4.52.50).
