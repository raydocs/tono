| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-1672-R1-ACCOUNT-ISOLATION | 登出/换账户时旧refresh/catalog异步结果可写回凭据或跨账户复用cache | fixed(b9d4df340) | #1672 | 高·推导 | main 基线已含源码修复；本轮复核通过既有回归，真机与真实账户仍未验证 |

2026-10-24 T2 复核：`322f48c6f` 已含 `b9d4df340`；不重复改写已合实现。证据：Account.swift:112-138,216-241,281-304 的 epoch/lease/owner 检查；AppModel.swift:135,287-309,698-714 的 accountEpoch 检查；AccountIsolationTests 9 项受控 gate 回归通过。[CI checkout ada2fe694](https://github.com/raydocs/tono/actions/runs/40083275707/job/120841004218) 中上述 suite 均为 0 failures；该 run 的新 T2 回归失败不影响这两组既有测试结果。固定状态只表示源码已合 main，不表示真机完成。
