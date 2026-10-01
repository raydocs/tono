| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4-WIN-UPDATE-RECOVERY-LOOP | 更新回滚本身反复失败时，Uncertain 状态的恢复执行器不记录自身，每次 Service 启动都会重新拉起它：停 Service、失败、重启，无限循环 | in-PR | [#1292](https://github.com/raydocs/tono/issues/1292) / [#1297](https://github.com/raydocs/tono/pull/1297) | 中·推导（P2，各步读码确认，循环未运行） | #1297：恢复执行器停 Service 前记录自身；网络落定（放行并保留 AI 拦截，或严格模式）后才计一次失败，3 次后不再拉起，Service 正常启动，更新状态带 needs_attention；Service 启动遇到 Uncertain 记录时让 watchdog 反复放行非严格屏障（保留 AI 拦截）；耗尽后允许手动安装，安装后组件证明为原版或目标版才归档记录（保留高水位）。仍需回滚故障注入实机验证；更新的新签名版本仍无法修复耗尽记录，安装其他版本则记录保持挂起 |
