| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4CPC-QUOTA-MINUTE-PAIR | An incomplete same-minute observation erases complete counters and creates a false quota reset | fixed | [#1183](https://github.com/raydocs/tono/pull/1183) | 低·已确认 (P2) | Real Worker/D1 regression; ops node quota only, with separate out-of-order admission unresolved |

The raw sample upsert replaced both cumulative counters even if one incoming value was null. `readAgentNetCounters` then selected an older complete pair, which `rollNodeCycle` treated as a counter reset. A complete 200 reading followed by an incomplete observation and then 300 yielded 400 usage instead of 200 in the D1 proof. The fix preserves an already complete pair on an incomplete overwrite, without mixing observations or suppressing real resets. This complements #1015's retention preservation; the failure here occurs before retention.
