| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-MONITOR-STALE-KS | 健康监视器在探测之后写回开始时的杀开关，界面可以显示已经不在的隧道许可 | in-PR | [#905](https://github.com/raydocs/tono/issues/905)，[#942](https://github.com/raydocs/tono/pull/942) | 中·推导 | 不改 WFP；网络事件计数仍用旧快照 |

写回前再读 `snapshot_generation`。代数变化时发布新读数；连接代已经换掉、会话不再是 Connected，或第二次读取失败时，不覆盖应用里已有的读数。
