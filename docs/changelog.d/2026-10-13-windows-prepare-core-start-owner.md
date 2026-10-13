> 搁置：Codex 审阅 block，未采纳，不应随版本发布；仅在所有者决定后重做。

## 2026-10-13 · 用户 B 接管已注销用户 A 的屏障后，连接失败不再让机器停在 Blocked
- 归属：Windows 多用户生命周期（issue #1293 第 1 项）。不属于 SHIP_PLAN 门。
- 问题：A 注销时释放失败，屏障仍记在 A 名下；B 点 Connect，`PrepareCoreStart` 停了 A 的 Core，但记录的 owner 要到 `StartClash` 的 `arm_bootstrap` 才改成 B。两步之间失败，`fail_connect` 的释放被 `authorize_write_for` 当成别的用户拒绝，B 从在线变成 Blocked。
- 修复：`PrepareCoreStart` 在停 Core 前，用与 `arm_bootstrap` 同样的接管规则（A 已无登录会话）把记录的 owner 改成 B。A 仍登录时照旧拒绝且不停任何东西。没有放宽 `authorize_write_for` 或“恢复上网”的 owner 检查。决策 126（provisional）。
- 验证：`windows / service` 两个新单测。
