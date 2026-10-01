| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4CPC-CLOSE-REPLACEMENT | A concurrently replaced Claude account escapes account close and remains billable | fixed | [#1186](https://github.com/raydocs/tono/pull/1186) | 低·已确认 (P2) | Requires overlapping close/replacement operations; Worker/D1 regression, no historical data rewrite |

Close used an assignment read before its D1 transaction. A replacement committed before that transaction could retire the old assignment and insert a new one; closing by the old ID changed nothing while the customer was disabled. Billing reconciliation treats assigned product accounts as billable independently of user status. The fix selects the live assignment for its event and retirement within the same close transaction.
