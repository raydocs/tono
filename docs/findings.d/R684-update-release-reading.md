| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R684-update-release-reading | 待完成更新的 Disconnect 已释放 WFP，独立状态回读失败却绕过未确认处理并保留已保护缓存 | in-PR | [#684](https://github.com/raydocs/tono/pull/684)；评审 56d02a04 grok:F1，codex 确认 | 高·已确认 | 本地修正让更新结果适配器共用 release_failed，错误时清缓存并返回 TONO_PROTECTION_UNCONFIRMED；协调器保留阻断/重试锁存。增加一条生产适配器回归。未运行 Service IPC/WFP 故障注入；红/绿 hosted CI、新 head 跨厂商复核和合并均待完成 |
