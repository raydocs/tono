| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-CATALOG-HISTORY | An open catalog history continues marking the old revision current after publication | fixed(e7d14f39) | [#965](https://github.com/raydocs/tono/pull/965) | 低·已确认 | P2; ui-review, no auto-merge |

`services/ops-console/src/pages/settings/Catalog.tsx:176`. History uses a fixed request key. After a successful r37→r38 publication, the headline advances but the mounted history has no r38 and still marks r37 current. Key the history read by the online revision so publication/reload/conflict invalidates the old history.
