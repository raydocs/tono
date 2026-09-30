| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-PARTIAL-INVENTORY | 对账部分成功或完整对账后的非 ACK 拒绝仍不落盘新增客户端，后续无法列出时吊销会漏掉它 | open | [#810](https://github.com/raydocs/tono/issues/810) | 高·推导 | 未改代码。#780 只覆盖完整对账后的名册 ACK 失败。本轮不再改 exit-agent |

`reconcile` 在成功的增删上更新 `known_installed`，失败时于 `reconcile_and_report.py` 1094 行抛出且不返回该集合。`run_once` 只在对账函数返回后保存 `installedClients`（1732–1735）。缓存写入失败、状态文件不可用、source 不匹配、待报 `observedAt` 超窗（1703–1724）也发生在这次保存之前。实时列表未知时不得把空集写成库存。
