| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-CP-LEDGER-CLOSE-RACE | 关账汇总读取与落锁之间成功入账，冻结金额漏记该笔账 | fixed(abf1bfdb) | hunt/sol-cp-month-close-ledger-fence | P2·已复现 | 仅防账目新增与归属变更；活动和资产读取仍非同一快照 |

`postMonthClose` now computes from an explicit ordered ledger snapshot and atomically checks its IDs and subject allocation before inserting the close. Changed inputs return 409 `LEDGER_CHANGED`; competing closes retain `MONTH_CLOSED`. One barrier regression inserts a real ledger entry before the close statement, verifies no stale close is stored, and checks both entries remain in the live summary.
