| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PAUSE-WATCHDOG-STALE-BLOCK | macOS 其余「Core 停、PF 留、重试暂停」路径（HY2 三振、重启后不自动恢复、唤醒时已有暂停、helper 拒绝）约 30 秒后被 helper 看门狗释放（保留 AI 拦截），App 只在窗口激活时对账，菜单栏继续显示 Protected Offline | open | [#1287](https://github.com/raydocs/tono/issues/1287) | 中·推导（P2） | 决策项：非严格模式直接释放（决定 031），或仿 Windows R2-F2 加 30 秒空闲轮询（建议）。未实机 |
