| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| REGLATE-MAC-POLICY-REQUEUE | macOS optional DIRECT policy owner re-read the live selection after its awaits, so a catalog that removed the selected exit meanwhile made it arm PF without the exit the Core still dialed, and any apply that failed before `/core/sync` was never queued again, so a revoked DIRECT grant stayed in force | fixed(3c792d20) | #1238 / #1338 | 中·推导（P2，源码与回归） | needs-hardware; after two failed retries the accepted document still waits for the next document or Connect; the survivor switch itself still arms without the removed exit for its own duration (existing #1115/#1149 behaviour) |

RegLate macOS regression pass (main `b9ab47db`, report `docs/agent-reports/2026-10-01-claude-reglate-macos.md`, REG-1115 / REG-1158).
The owner now (1) queues itself behind a pending catalog removal instead of arming, (2) uses one captured selection (PF exit endpoints,
node list, overlay) for every arm and for the document it writes, (3) restores PF after a failure only when it had armed, with the endpoints
it armed, and (4) queues a failed apply again, at most twice per session and policy revision. No AI route or AI hold is involved; the
existing teardown after a failure past `/core/sync` is unchanged. Regressions: `OptionalPolicyTests`.
