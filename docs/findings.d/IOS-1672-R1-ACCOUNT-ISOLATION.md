| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-1672-R1-ACCOUNT-ISOLATION | 登出/换账户时旧refresh/catalog异步结果可写回凭据或跨账户复用cache | open | #1672 | 高·推导 | GPT F1；Account.swift/AppModel.swift，源码推断，未运行故障复现；WIP批量实现中，尚未云验；不把fixture单测/UI绿灯当作该故障已覆盖 |

本轮源码已集成至WIP，尚未云验、未更新PR；确切新增回归与实现边界见状态矩阵S15–S17。状态保持open，不将静态diff检查写成修复通过。
