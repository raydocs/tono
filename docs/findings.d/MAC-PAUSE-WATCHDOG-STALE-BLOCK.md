| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PAUSE-WATCHDOG-STALE-BLOCK | macOS 其余「Core 停、PF 留、重试暂停」路径（HY2 三振、重启后不自动恢复、唤醒时已有暂停、helper 拒绝）约 30 秒后被 helper 看门狗释放（保留 AI 拦截），App 只在窗口激活时对账，菜单栏继续显示 Protected Offline | fixed(7df1dc72) | [#1287](https://github.com/raydocs/tono/issues/1287)；本 PR；余项 [#1305](https://github.com/raydocs/tono/issues/1305) | 中·推导（P2） | HY2 三振、重启后不自动恢复、唤醒时已有暂停改为立即自动失败释放（保留 AI 拦截），暂定决定 044。helper 拒绝无法在无管理员提示时释放或读回，拆到 #1305（[MAC-HELPER-REJECTION-STALE-BLOCK](MAC-HELPER-REJECTION-STALE-BLOCK.md)）。XCTest 只在 hosted CI；未实机，needs-hardware |
