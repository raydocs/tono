| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-MU-FAILED-CONNECT-BLOCKED | 用户 A 注销时释放失败，策略以 owner A 保持武装；用户 B 点 Connect，`PrepareCoreStart` 停掉 A 的 Core，B 的尝试在 `arm_bootstrap` 之前失败，`fail_connect` 的释放被 `authorize_write_for` 以 owner A 拒绝，B 从在线变成 Blocked | fixed | [#1293](https://github.com/raydocs/tono/issues/1293)（第 1 项） | 低·推导（P3，读码） | 决策 126（provisional）：`PrepareCoreStart` 停 Core 前用 `authorize_takeover_for` 的同一规则把记录的 owner 改成 B；没有放宽任何释放权限。仍缺双账号实机复现；`PrepareCoreStart` 路由本身没有单测，只测了转移函数 |
