| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-EXIT-ROSTER-STALE-NO-ALERT | exit 节点 15 分钟没有 roster ACK 时目录对所有客户移出该节点（`exitAckGate`），但没有任何告警；一个卡住的撤销或客户端增加就能让节点静默下线 | fixed(b069ea5f0) | [#1784](https://github.com/raydocs/tono/pull/1784) | 中·已确认（红测） | 新增 `node-roster-stale` 节点事件（warn），经现有告警规则发出，下一次 ACK 后解除；不限 kind、最低级别 ≤ warn 的现有告警规则会自动推送，否则需加规则；控制台按未映射事件显示（只有认领） |
