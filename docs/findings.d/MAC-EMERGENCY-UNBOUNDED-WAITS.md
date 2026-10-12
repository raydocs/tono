| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-EMERGENCY-UNBOUNDED-WAITS | macOS `--emergency-disarm` 这条最后出口仍有无界等待：在线 daemon 持有更新锁时 `emergencyRelease → storage.locked` 一直循环（`main.swift` L1358、`UpdateStorage.swift` L109–123）；`retireResolved → UpdatePackage.run` 用无界 `waitUntilExit()`（`UpdatePackage.swift` L267–275） | open | [#1504](https://github.com/raydocs/tono/pull/1504)，评审回执 [1504#issuecomment-6097948750](https://github.com/raydocs/tono/pull/1504#issuecomment-6097948750) | 高·推导 | main 上已存在（非 #1504 引入）；评审定级 major；按总账等级取高，与 MAC-EMERGENCY-STALE-CORE（最后手段卡住、机器留在断网状态）同档；A13 评审中发现；A13 的 PR #1504 是草稿，等所有者决定；无修复 PR；读码推导，未实机 |

GPT-6 Astra（high）复审 #1504 @`7b6f68c4` 的 R3（major，pre-existing, reachable）。#1504 本身因 R1/R2 需要所有者在「操作员释放互锁 / 不重启 / 保持现状」之间决定，已转草稿未合。
