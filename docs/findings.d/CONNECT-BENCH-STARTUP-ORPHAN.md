| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CONNECT-BENCH-STARTUP-ORPHAN | Benchmark controller startup failure leaves the started core child running; sing-box spawn failure also leaves its log open | fixed(08aac566e3adde2f8beaffce84da2bb5c774bd92) | [#1000](https://github.com/raydocs/tono/pull/1000) | 低·已确认（P2，Linux 回归） | Loopback benchmark tooling only; no customer runtime networking changed. Successful sample-phase exceptions remain outside this startup fix. |

Constructors now close their child on readiness failure or interruption, and sing-box closes its log on spawn/cleanup errors. Forced stops include a bounded reap after kill.
