## 2026-10-10 · macOS 掉线恢复：未 armed 循环发起的连接在 PF armed 前失败时，恢复交回循环，不再停在「未连接」
- 归属：ops 任务（[运维计划](../ops/plan-2026-09-11.md)；中国大陆连通性审计，掉线 / 网络切换恢复）；macOS App 连接 FSM（未 armed 分支）。
- 来源：origin/main `3d973f95` → 分支 `amp/cn6-unarmed-retry-after-prearm-failure`，[#1533](https://github.com/raydocs/tono/pull/1533)；未合 main。
- 缺陷修复（MAC-UNARMED-PREARM-FAILURE-NO-RETRY）：受保护连接掉线、自动释放后，未 armed 循环在 TCP 证明通过时发起连接并退出；这次连接若在 PF armed 前失败，
  只做清理，没有任何后续重试，网络变化也不再重启（循环已无 owner）→ 新增 `AppState.unarmedLoopResumesAfterPreArmFailure`：由该循环发起
  （`preservingUnarmedBackoff`）、失败不需要用户处理、且不在 helper 准备阶段的，在释放之后调用 `scheduleUnarmedReconnect()`（先等清理完成，保留退避档位 2/5/15/30/60/120 s）。
- 新增/优化：无。不改 PF / helper；armed 分支、用户手动连接、需要用户处理的失败（拒绝授权、安装失败、helper 拒绝）都不变；helper 准备阶段的失败不自动重试，避免反复弹管理员授权。
- 工程与测试：`UnarmedConnectFailureTests.testAnAutomaticConnectThatFailsBeforeArmingHandsRecoveryBackToTheUnarmedLoop`（模拟：目录出口缺 uuid，连接在 helper 准备前确定失败；
  断言 PF 未 armed、失败留档、循环重新持有恢复 `unarmedReconnectAwaitsNetwork`）。
- 验证：Swift/XCTest 本机（Linux）不可运行，交由托管 CI（ci-gate）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机。连接 FSM 改动，按 AGENTS 属高风险，需独立评审回执。审计另见未修：自动释放本身失败后停在 Protected Offline 不重试（gap A）；
  唤醒后的连接在准入阶段被拒时不排重试（gap C）；网络变化在连接中被挂起、连接失败后被丢弃（gap D，只是延迟）。
