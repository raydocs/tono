| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-PARTIAL-RECONCILE-METERING | 单个客户端 add/remove 失败时 `reconcile` 在读计数之前就抛出，整节点所有账号的用量都不上报（额度执行跟着停），遇 Xray 重启还会免计 | in-PR | fix/exit-agent-metering-durability | 中·已确认（红测：无任何上报） | 改为照常读数上报、两种 ACK 都不发（决定 139，owner 选 A）；撤销失败不 ACK、每轮重试，有测试；hy2 与 reconcile 同时失败的轮次仍不读数 |
