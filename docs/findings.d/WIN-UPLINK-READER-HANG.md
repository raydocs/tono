| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPLINK-READER-HANG | Windows `usable_physical_uplinks` 的原生 spawn_blocking 没有超时，IP Helper 挂起时带 DIRECT 的监控循环会停住 | in-PR | [#1395](https://github.com/raydocs/tono/pull/1395) | 中·实机 | 防御性修复：5 秒期限加进程内单飞名额（`bounded_native_read`），超时按未知处理，不保留 DIRECT 原地会话，照决策 030/031 处置；挂起是否真实发生仍需实机；回归 `hung_uplink_reader_is_bounded` 未在本机运行 |

记录于 #1386。

2026-10-05 三轮：按 Codex 的修法加期限与单飞名额，#1395。挂起本身仍未实机证明。
