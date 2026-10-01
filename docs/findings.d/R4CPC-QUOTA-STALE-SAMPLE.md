| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4CPC-QUOTA-STALE-SAMPLE | An interface reading taken before an overlapping quota roll committed is compared with the newer counter and counted as a reset | in-PR | [#1181](https://github.com/raydocs/tono/issues/1181) | 低·已确认 (P2) | Real Worker/D1 regression; ops node quota only; a dropped reading is counted by the next cumulative reading |

`rollAllNodeCycles` and the profile save read the interface counters before `rollNodeCycle` read the open cycle. If another roll committed a newer reading in between, the older reading looked lower than `counter_last` and was counted as a reset (baseline 100, newer 200, stale 150: usage 250 instead of 100). The fix reads the counters after the cycle and admits the reading with a compare-and-set on the cycle row it read; a reading overtaken by another roll is dropped (its traffic is in the next cumulative reading). Real counter drops still count as resets. No schema change.
