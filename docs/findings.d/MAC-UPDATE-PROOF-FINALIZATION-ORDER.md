| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-UPDATE-PROOF-FINALIZATION-ORDER | release 的 update disconnect proof 先于最终 authority 保存和 quarantine recovery，后续失败可令报告 unknown 而 verified 已持久化 | open | [#1740](https://github.com/raydocs/tono/pull/1740) R2 残余 | 中·推导（P2，独立静态审查） | 未修；未做最终保存/recovery 故障注入；不把候选 terminal outcome 当作最终报告已成功 |

审查范围 `6c3a0be5f...f91689a31`，R2 verdict **approve-with-fixes**。
证据：`tooling/scripts/core-helper/ReleaseWorker.swift:282-298` 先 markUpdateDisconnectVerified，后 authority.save；
`run` 中在 release barrier 退出后执行 ReleaseQuarantine.recover，失败被记录进最终报告。
因此最终报告可能 unknown，但 update ledger 已保存 disconnectVerified=true。

后续修法方向：完成最终保存/recovery 的可失败步骤后，再在 release barrier 内重新核对 identity/generation 并保存 proof；
补最终 authority 保存及 recovery 失败的受控回归，防止账本与最终报告不一致。
不得简单移出 barrier 后无代次/实体核对地晚写，也不能清空 high-water、改变 phase 或放宽退役组件校验。

按项目“两轮审查 / minor 一轮修正”的停止规则记为开放残余，不启动第三轮，不标为修复或审查全通过。
