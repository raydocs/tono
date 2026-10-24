| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-HY2-ERROR-DROPS-LEDGER-MISSING | hy2 发布失败时缺失账本把 xray 原始计数写成终身用量，下一轮无水位会再报一遍 | in-PR | [#1743](https://github.com/raydocs/tono/pull/1743) | 高·已确认 | 未在出口节点上重放；控制面「更低总量整段累加」未改 |

`run_once` 在 `services/exit-agent/reconcile_and_report.py` 的 hy2 失败分支调用 `keep_usage_locally` 时未传 `ledger_missing`（修复前约 1954 行）。停用轮与控制面不可达轮已经传递。`take_ledger_missing` 会弹出 `_ledgerMissing`，漏传后原始计数写入 `totals`。修复后该分支与另外两处一样，缺失账本把总量记 0、基线记在当前原始读数上。已有账本的本轮增长仍保留。
