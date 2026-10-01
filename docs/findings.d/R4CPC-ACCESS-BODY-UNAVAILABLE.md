| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4CPC-ACCESS-BODY-UNAVAILABLE | Interrupted Access signing-key body falsely reports expired authentication | in-PR | [#1190](https://github.com/raydocs/tono/pull/1190) | 低·已确认 (P3) | Worker/D1 regression; authentication stays closed, valid cookies are not revoked, configured polling can recover |

The provider fetch and JSON parse classified service failure, but the streamed body read could throw an untyped transport error. `operationsAdmin` converted it to 401, which the console treated as an expired session. The fix retains the existing unavailable classification through the body read; a repeated request with the same valid assertion succeeds after provider recovery.
