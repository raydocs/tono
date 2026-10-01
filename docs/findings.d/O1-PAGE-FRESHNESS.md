| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-PAGE-FRESHNESS | A fresh shared health read makes old page data appear newly fetched | in-PR | [#880](https://github.com/raydocs/tono/pull/880) | 低·已确认 | P2; ui-review, no auto-merge; specific OPS-1 freshness defect |

A failed refresh keeps the previous ready resource and its original `fetchedAt` by design. Today, Customers, Nodes and Clients chose the maximum timestamp across page inputs, so healthy `/health` polling hid an old incidents/customers/nodes/releases answer. Clients' adoption/channel reads also do not poll and were always covered by the shared reads. Page stamps now choose the oldest available input; initial missing reads keep their existing loading/error presentation. The page warning describes aging data, rather than claiming the whole backend is unreachable. Shell last-contact time still uses the newest read.
