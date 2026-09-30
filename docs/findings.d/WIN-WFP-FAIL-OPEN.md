| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-WFP-FAIL-OPEN | 损坏的 kill-switch 意图和不健康的 WFP 看门狗会装上或重装全阻断，崩溃后机器没有出口 | in-PR | 待开 | 高·推导 | 可读 wanted 意图的启动恢复未改；界与 DNS 需要实机 |

服务启动在 JSON 损坏、文件读不出、意图校验失败，或没有意图却有残留过滤器时，不再安装 ownerless 紧急阻断，除非记录里 `strict_kill_switch` 为真。看门狗不健康时不重装；非严格连续 3 次、严格连续 30 次后释放 WFP 并尝试恢复 DNS。损坏字节保留。needs real-hardware testing。
