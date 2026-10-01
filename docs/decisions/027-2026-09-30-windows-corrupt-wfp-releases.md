## 2026-09-30 · On Windows, should corrupt WFP state or an unhealthy watchdog keep a block?

- Status: provisional
- Chosen: no, unless the on-disk record explicitly sets `strict_kill_switch` (or the PF desired mode is Permanent). Corrupt, unreadable, unusable, and residual-without-intent paths release WFP and attempt DNS restore. The unhealthy watchdog waits three ticks, then releases; strict mode reinstalls and still releases after thirty consecutive unhealthy ticks. Rejected: keeping the ownerless emergency block, and deleting corrupt bytes to synthesize a tombstone.
- Why stricter: an unreadable file is not an opt-in, so it cannot keep the machine closed. A live wanted session is still restored when the record parses and the install verifies. The cost is a connected session whose WFP verify fails for about three seconds loses the block until the next arm. Needs real-hardware testing.
- Applied in: [#733](https://github.com/raydocs/tono/pull/733) (`windows_kill_switch.rs`, `macos_kill_switch.rs`).
