| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| issue-816 | dual 阶段旧 v1 命名来源在计数器重置后重放仍保留的旧高位报告（900@t1、120@t2 后重放 900@t1），v1 高计数例外把它当新增长再记 780，用量从 1,020 变成 1,800，可能提前耗尽配额 | in-PR | [#816](https://github.com/raydocs/tono/issues/816) · [#1441](https://github.com/raydocs/tono/pull/1441) | 低·已确认 | 不加迁移：折叠只排除已被同一账户、同一来源更晚插入（rowid）报告取代的保留 v1 报告；时钟回拨的新报告仍是最新行，保留原例外。报告 ID 被 14 天保留清理删掉之后再重放，会作为新行插入，仍可能重记（与 v2 不同，v1 没有单调水位）；v1 来源退役后消失 |

Sol2 bug hunt（GPT-6.1 Sol，n07_cp_route，n07-3）发现；回归 `does not refold a replayed legacy v1 report after a counter reset (#816)` 在旧代码上得到 1,800，修复后为 1,020。
