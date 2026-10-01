| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-PARTIAL-INVENTORY | 对账部分成功或完整对账后的非 ACK 拒绝不落盘新增客户端，后续无法列出时吊销会漏掉它 | in-PR | [#810](https://github.com/raydocs/tono/issues/810) [#838](https://github.com/raydocs/tono/pull/838) | 中·推导 | 只保存已知 installedClients，不 ACK、不推进用量；未知库存仍不写。下一轮若能列出 inbound 仍按实况撤除。未部署 |

`reconcile` 把已成功的增删留在异常的 `installed` 上。计数读取失败、名册缓存删不掉、source 不匹配、待报 `observedAt` 非法或超窗，都在名册 ACK 之前把该集合写入状态文件。停机轮次的对账拒绝同样只补库存。
