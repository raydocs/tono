| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-ADOPT-RETRY | 更新恢复在同一进程里重试时，已改绑的后继仍被当成可以自动再连 | fixed(85100041) | [#772](https://github.com/raydocs/tono/pull/772) | 中·已确认 | 未在 Windows 上走更新中途的账户重试 |

`adopt_successor` 在改绑之后再次回答 `successor_relaunched == false`。`Adoption::after` 对已经是 Allowed 的状态仍接受这个回答。
