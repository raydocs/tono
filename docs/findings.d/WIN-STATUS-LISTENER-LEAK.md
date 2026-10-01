| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-STATUS-LISTENER-LEAK | A Windows page mounting after status registration settles creates and leaks another backend listener, duplicating all later status callbacks | in-PR | [#820](https://github.com/raydocs/tono/pull/820) | 低·已确认（P3） | Local source-execution regression passed; pinned Vitest/typecheck await hosted CI; no visual or network behavior change |

`src/services/tono.ts:861`: `ensureSharedListener` checked only an in-flight registration promise, which is cleared after completion. It now also checks the existing live listener.
