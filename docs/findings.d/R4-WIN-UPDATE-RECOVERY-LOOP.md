| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-UPDATE-RECOVERY-LOOP | 更新回滚本身反复失败时，Uncertain 状态的恢复执行器不记录自身，每次 Service 启动都会重新拉起它：停 Service、失败、重启，无限循环 | open | [#1292](https://github.com/raydocs/tono/issues/1292) | 中·推导（P2，各步读码确认，循环未运行） | 需要回滚故障注入实机验证；非严格模式网络已放行且 AI 仍拦，但 IPC 始终不稳定 |
