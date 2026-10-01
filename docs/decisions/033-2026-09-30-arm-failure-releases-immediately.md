## 2026-09-30 · On arm or sleep-barrier failure, keep the all-block until the next helper start?

- Status: provisional
- Chosen: no. Release the anchor and the saved intent immediately. A failed update rollback does the same before it returns. Rejected: installing an emergency all-block and waiting for the next daemon start. macOS has no strict kill-switch opt-in.
- Why stricter: a failed commit does not leave the host offline. A successful sleep barrier is unchanged. The cost is that a failed re-arm also drops the previous block.
- Applied in: [#708](https://github.com/raydocs/tono/pull/708) (`KillSwitchManager.swift`, `UpdateExecutor.swift`); BRICK-M8, BRICK-M13.
