| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-DESTINATION-NODE | Destination totals from multiple cloud exits are attributed to the first exit | in-PR | [#869](https://github.com/raydocs/tono/pull/869) | 低·已确认 | P2; ui-review, no auto-merge; SSR regression passed |

`Destinations.merge` keyed only destination and route, then kept the first row's node while adding later nodes' counters. The Worker returns day/destination/route/node rows separately. A customer switching cloud exits during a week therefore showed both exits' traffic under one exit. Include node in the grouping key; retain cross-day aggregation for each exit.
