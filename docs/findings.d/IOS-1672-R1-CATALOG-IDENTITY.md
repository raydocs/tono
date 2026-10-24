| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-1672-R1-CATALOG-IDENTITY | 同mode/node的新catalog可被用于描述另一份仍运行的图，造成Home/RouteCheck路径误导 | fixed(b9d4df340) | #1672 | 高·推导 | main 基线已含源码修复；本轮复核通过既有回归，真机与真实账户仍未验证 |

2026-10-24 T2 复核：`322f48c6f` 已含 `b9d4df340`；不重复改写已合实现。证据：TunnelConfirmation.swift:311-365 的 CatalogLedger 按 digest 解释；AppModel.swift:735-789 只用确认 digest 的 catalog；CatalogConfirmationTests 5 项（同 mode/node 不同 Home 路径、旧答复无 digest、失败重建恢复身份）通过。[CI checkout ada2fe694](https://github.com/raydocs/tono/actions/runs/40083275707/job/120841004218) 中上述 suite 均为 0 failures；该 run 的新 T2 回归失败不影响这两组既有测试结果。固定状态只表示源码已合 main，不表示真机完成。
