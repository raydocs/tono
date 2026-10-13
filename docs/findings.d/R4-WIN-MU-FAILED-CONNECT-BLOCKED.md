| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-MU-FAILED-CONNECT-BLOCKED | 用户 A 注销时释放失败，策略以 owner A 保持武装；用户 B 点 Connect，`PrepareCoreStart` 停掉 A 的 Core，B 的尝试在 `arm_bootstrap` 之前失败，`fail_connect` 的释放被 `authorize_write_for` 以 owner A 拒绝，B 从在线变成 Blocked | fixed | [#1293](https://github.com/raydocs/tono/issues/1293)（第 1 项）· PR #1643 | 低·推导（P3，读码） | 决策 126：停 A 的 Core 时在释放锁 C 下一个事务完成“确认无在途释放、退休 A 的连接、改 owner、停 Core”；`authorize_write_for` 与 `owner_refusal` 未放宽。`atomic_write` 的 BRICK-W11 迟到 rename 仍不覆盖；双账号实机未验证 |
