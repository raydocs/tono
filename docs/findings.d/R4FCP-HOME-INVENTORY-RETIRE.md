| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FCP-HOME-INVENTORY-RETIRE | Standalone inventory retirement can strand a concurrently assigned home | fixed | [#1198](https://github.com/raydocs/tono/issues/1198); [#1203](https://github.com/raydocs/tono/pull/1203) | 中·已确认（P2） | Requires overlapping administrator requests; native acceptance not run |

Shared-admin PATCH, v1 PATCH, v1 DELETE-as-retire and assignment replacement checked for bindings before an unconditional status write. All four real D1 regressions fail on baseline `9369e620`: the binding succeeds and the home becomes retired, making catalog delivery fail with503. Each retirement write now checks current bindings atomically. Explicit retirement refuses without changing metadata, revision or audit; automatic cleanup preserves a home claimed by another customer. The intentional `disabled` pause remains permitted.
