| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4CPC-OIDC-BODY-UNAVAILABLE | Provider key-response body failure is misclassified as rejected authentication | in-PR | [#1176](https://github.com/raydocs/tono/pull/1176) | 低·已确认 (P3) | Worker/D1 failing-then-passing regression; current native OIDC sign-in is a macOS debug path, with no live-session sign-out demonstrated |

A successful HTTP header response followed by a streamed body failure escaped the typed temporary-provider error in `src/oidc.ts`. The verify endpoint consequently returned 401 rather than the existing 503 unavailable response. The fix preserves the temporary error across the body read; token verification and challenge bounds remain unchanged.
