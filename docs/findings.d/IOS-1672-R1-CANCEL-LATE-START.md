| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-1672-R1-CANCEL-LATE-START | Cancel发生在VPN配置save/load await期间，旧start可恢复并启动隧道 | open | #1672 | 高·推导 | GPT F3；TunnelController/AppModel，源码推断，未真实NE复现；WIP批量实现中，尚未云验；不把fixture单测/UI绿灯当作该故障已覆盖 |

本轮源码已集成至WIP，尚未云验、未更新PR；确切新增回归与实现边界见状态矩阵S15–S17。状态保持open，不将静态diff检查写成修复通过。
