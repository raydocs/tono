## 2026-10-13 · 用户 B 接管已注销用户 A 的屏障后，连接失败不再让机器停在 Blocked
- 归属：Windows 多用户生命周期（issue #1293 第 1 项）。不属于 SHIP_PLAN 门。
- 问题：A 注销时释放失败，屏障仍记在 A 名下；B 点 Connect，`PrepareCoreStart` 停了 A 的 Core，但记录的 owner 要到 `StartClash` 的 `arm_bootstrap` 才改成 B。两步之间失败，`fail_connect` 的释放被 `authorize_write_for` 当成别的用户拒绝，B 从在线变成 Blocked。
- 修复：`PrepareCoreStart` 在停 A 的 Core 时，持有释放进程的跨进程锁，在同一事务里确认上一次释放已被证明结束（否则返回可重试错误）、退休 A 的连接记录、把记录的 owner 改成 B（A 已无登录会话才允许，与 `arm_bootstrap` 同一规则），再停旧 Core。别的用户的连接仍在记录里时拒绝接管。写盘失败时按磁盘实际内容决定是否更新内存；无法确认时不做补偿写，而是让 owner 门暂时拒绝并从磁盘重新对账。A 仍登录时照旧拒绝且不停任何东西。没有放宽 `authorize_write_for` 或“恢复上网”的 owner 检查。决策 126（provisional）。
- 验证：`windows / service` 新增 13 个单测（含 server 层门测试）：在途与未证明完成的释放、A 的连接退休、第三方连接、三种写盘错误、门侧对账、仍登录的 owner、无接管对象。
