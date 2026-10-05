| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPLINK-READER-HANG | Windows `usable_physical_uplinks` 的原生 spawn_blocking 没有超时，IP Helper 挂起时带 DIRECT 的监控循环会停住 | in-PR | [#1395](https://github.com/raydocs/tono/pull/1395) | 中·实机 | 防御性修复：5 秒期限加进程内单飞名额（`NativeRead`）；超时或名额被占都算「没有回答」，不作为放行依据：保持会话，之后的空闲拍再读，读到确认丢失才重建；原生读取报错照旧重建；超时后才返回的答案留给同一代次、同一网卡的下一次读取，读取开始后监控看到网络变化（每拍两次读到的 Service 网络事件计数任一次变化，或 Service 联系不上）即作废，「没有回答」标记在状态锁下核对代次后才写或清。读取一直挂住时，DIRECT 绑定的网卡若已消失，直连流量会一直失败到读取恢复（不泄漏；其间的网络变化同样得不到回答）；这类「一直得不到确认」另记 open 项 [WIN-DIRECT-BINDING-UNPROVEN](WIN-DIRECT-BINDING-UNPROVEN.md)。挂起是否真实发生仍需实机；回归 `hung_uplink_reader_is_bounded`、`late_uplink_answer_reaches_the_next_read`、`late_uplink_answer_does_not_cross_a_network_change`、`unanswered_uplink_read_keeps_a_proven_session` 只在 hosted CI 运行；标记的代次栅栏没有单独回归 |

记录于 #1386。

2026-10-05 三轮：按 Codex 的修法加期限与单飞名额，#1395。挂起本身仍未实机证明。Codex high 复审 major：第一版把「没有回答」当未知并放行，旧会话挂住的读取占着名额时，健康的新会话会被提前放行；已改为没有回答不放行。复审 major 两项：超时答案被丢弃（每次都超时的读取永远不回答）、旧代次可覆盖新会话的标记；已改为迟到答案留给下一次读取、标记在状态锁下按代次写入。二次复审 major：迟到答案没有新鲜度，可跨过之后的网络变化被采用；已改为读取记下开始时的纪元，监控看到变化即作废。minor：预算到点时恰好送达的答案会丢；已改为超时后关闭接收端再取一次。三次复审 major：同一拍第二次读 Service 状态时没核对事件计数；已改为两次都核对。另一项（Service 状态持续失败时答案总被作废）定为低，记 open 为 WIN-DIRECT-BINDING-UNPROVEN。
