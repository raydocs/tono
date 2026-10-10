| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| A18-AUDIT-STALE-WAS | A18 hy2 自动切换开关：审计文案「auto-switch was …」用的 `before.effective` 在批处理之外读取（`shared-admin/hy2-auto-switch.ts` 约 L76–99），并发写入时可能写出过时的前值（如 on→off 记成「was off」） | in-PR | [#1492](https://github.com/raydocs/tono/pull/1492)，评审回执 [1492#issuecomment-6097474529](https://github.com/raydocs/tono/pull/1492#issuecomment-6097474529) | 低·推导 | 只影响审计文本；权限结果与账户隔离正确；控制面未部署；修复 PR 待合（`amp/a18-audit-stale-was`） |

GPT-6 Astra（high）复审 #1492 @`cf1cbbbf` 的 minor，该 PR 的一轮 minor 修复已用完，记 open 后合入（`2e013d2b`）。
