| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4CP-LEDGER-NESTED-REVERSAL | Reversing a ledger reversal gives the wrong source-currency CSV total | in-PR | hunt/sol-r4cp-nested-reversal | P2·已复现 | Export correctness; stored CNY accounting remains correct; historical exports are not rewritten |

The merged #767 fix negates every row with `reverses`, although `postLedgerReverse` permits undoing a reversal. Actual Worker/D1 operations for +800, -800, +800 export source total -800 and CNY total +800. Source polarity follows the stored CNY sign. For nonzero source amounts rounded to zero CNY, the exporter resolves reversal depth across month boundaries; historical reversal UUIDs cannot be decoded from their ID. Two narrow API regressions failed before and passed after the fix.
