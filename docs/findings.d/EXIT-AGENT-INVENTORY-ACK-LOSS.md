| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-INVENTORY-ACK-LOSS | 完整对账后名册 ACK 失败丢失新增客户端的持久库存，后续吊销可能漏除 | fixed(378c165d) | #780 | 高·推导 | ACK 前仅保存已对账库存，usage 状态保持原提交顺序；部分失败与后续拒绝的库存见 EXIT-AGENT-PARTIAL-INVENTORY |

- `reconcile` 成功返回的库存包含已完成的新增和撤除；`run_once` 用 sourceId 更新前的状态快照，仅替换 installedClients 并原子保存。
- 旧累计量、原始基线、用户总量、重启标记、报告时钟与待报队列不提前提交；README 同步该顺序。
