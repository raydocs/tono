| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-EMERGENCY-UNBOUNDED-WAITS | macOS `--emergency-disarm` 这条最后出口仍有无界等待：在线 daemon 持有更新锁时 `emergencyRelease → storage.locked` 一直循环（`main.swift` L1358、`UpdateStorage.swift` L109–123）；`retireResolved → UpdatePackage.run` 用无界 `waitUntilExit()`（`UpdatePackage.swift` L267–275） | in-PR | [#1504](https://github.com/raydocs/tono/pull/1504)，评审回执 [1504#issuecomment-6097948750](https://github.com/raydocs/tono/pull/1504#issuecomment-6097948750) | 高·推导 | #1504 修复（helper 4.52.45，决定 084）：`--emergency-disarm` 的更新锁有 5 s 预算，超时跳过更新清理直接放行；本进程内 `UpdatePackage.run` 与 networksetup 子进程 15 s 后 TERM→KILL→放弃；各阶段有预算，整条命令上限 181.5 s；launchctl 连同 spawn 一起计时，有自测覆盖。守护进程与执行器路径的等待未改（不在最后出口上）；合入后改 fixed(<SHA>)；未实机 |

GPT-6 Astra（high）复审 #1504 @`7b6f68c4` 的 R3（major，pre-existing, reachable）。#1504 本身因 R1/R2 需要所有者在「操作员释放互锁 / 不重启 / 保持现状」之间决定，已转草稿未合。
