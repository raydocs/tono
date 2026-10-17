| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-THREE-TIER-DURABLE-RECOVERY | Service启动无法读取strict会话记录时缺少独立持久判据，可能把旧strict保护误当stable自动释放 | in-PR | [#1571](https://github.com/raydocs/tono/pull/1571) | 高·推导 | 续修在grant前落盘独立strict判据，记录丢失/损坏/不可读仍恢复Blocked，显式release后才清除；Bootstrap恢复一并收紧为floor。生命周期回归已补，准确head CI/独立复核待完成，非设备执行证明 |

来源：独立high审查准确head [0c60a578](https://github.com/raydocs/tono/commit/0c60a578b0d3bc76197fd5d134f3617959914eed)。未知strict判据内容或读失败均保留hold；stable未启用strict时原有损坏记录恢复合同不变。不公开操作序列；不宣称解决独立的#1071/#1504恢复工作。
