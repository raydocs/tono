| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UNICODE-EXIT-NAME | 没有 ASCII 字母或数字的出口名全被当成同一座城市，失败后换不走 | fixed(b8ab3895) | [#771](https://github.com/raydocs/tono/pull/771) | 中·已确认 | 国旗前缀仍忽略，相同 ASCII 身份仍视为同一出口 |

`compact_exit_name` 只保留 ASCII 字母数字。纯中文名折成空串后 `names_equivalent` 为真，`next_catalog_exit` 因此跳过目录里其余中文出口。
