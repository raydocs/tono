| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SELECTIVE-LATE-WORKER | Timed-out selective native cleanup/application can erase a newer AI hold or reinstate it after Restore | fixed(99aa433c) | [#988](https://github.com/raydocs/tono/pull/988) | 中·已确认（P2，Linux 时序回归） | Requires slow native work plus replacement/Restore; native Windows schedule unrun. One process is ordered; orphan child survival across process death and native failures remain best-effort limits. |

Dropping a timed-out `spawn_blocking` handle did not stop fixed-name/GUID mutation. A single coalescing worker now retains ownership after caller timeout and converges to the latest release/Restore/arm request. Caller waits remain bounded and the hold remains suffix/prefix-only.
