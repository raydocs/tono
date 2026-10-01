| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FCP-HOME-BIND-RETIRE | Concurrent fleet retirement can remove a catalog home while its assignment reports success | fixed | [#1102](https://github.com/raydocs/tono/issues/1102); [#1170](https://github.com/raydocs/tono/pull/1170) | 中·已确认（P2） | Overlapping administrator actions; installed exit acceptance not run |

Retirement preview checks bindings before its batch; binding writes before its separate revision bump. Real local D1 tests fail in both commit orders, including replacement of an existing binding. The retirement catalog UPDATE now checks current catalog-home bindings; binding writes refuse matching retired fleet profiles. The existing atomic retirement batch and relist lifecycle preserve both fences. Unknown profiles remain allowed for pre-catalog provisioning.
