| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| #191 | D1 当月冲销警告需吸收且不覆盖 Batch 8 Ledger | in-PR | [#191](https://github.com/raydocs/tono/issues/191)，[#647](https://github.com/raydocs/tono/pull/647) | 低 | 目标月锁定为读取快照，最终以后端 MONTH_CLOSED 为准；未做浏览器实机截图验收 |

在当前 main 上重做已关闭 PR #209：冲正按当前 UTC 月锁定状态放行，文案区分当前月与历史月，迟到的 MONTH_CLOSED 给出上下文提示。
