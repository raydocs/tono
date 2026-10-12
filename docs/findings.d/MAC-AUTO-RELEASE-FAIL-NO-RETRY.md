| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-AUTO-RELEASE-FAIL-NO-RETRY | macOS 受保护连接耗尽失败后的「自动释放」（`applyExhaustedArmedFailure` → `disconnect(releaseKillSwitch: true, automaticFailureRelease: true)`）本身失败（helper 修复、DNS 恢复或 disarm 失败）时，PF 仍 armed、停在 Protected Offline；`ConnectionCoordinator.enqueueDisconnect` 对 `.automatic` 也写入 `disconnectQueueReleaseIntent`，未确认的释放一直保留这个意图，于是网络变化（`AppState.handleSystemNetworkChange` 的 `!disconnectQueueRequestsRelease`）和睡眠 / 唤醒都跳过恢复，未 armed 循环也因 `KillSwitchService.isArmed` 退出；只能等用户点重试 / 恢复正常网络 / 连接 | open | [#1533](https://github.com/raydocs/tono/pull/1533)（审计记录）；修复 [#1592](https://github.com/raydocs/tono/pull/1592)（draft，未合） | 中·推导 | 不泄漏（PF 仍拦截），但不会自行恢复；X1-2 的「保留释放意图」原是为用户自己的「恢复正常网络」设计的。修法涉及 PF 释放语义与连接 FSM（高风险），需独立评审；待实机 |

2026-10-12：修复在 PR #1592（未合 main，状态保持 `open`）。保留的释放意图按来源区分，自动来源的由下一次网络变化或唤醒重跑自动释放；用户来源的行为不变。合并后改 `fixed(<main SHA>)`，仍待实机。
