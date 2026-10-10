## 2026-10-10 · macOS 更新：用户在后台检查的提示上点了「安装并重启」后，下载失败要告诉用户
- 归属：ops 任务（[运维计划](../ops/plan-2026-09-11.md)；中国大陆连通性审计，延续 [Amp backlog](../ops/amp-backlog-2026-10-10.md) A2 / #1516）；macOS App 更新入口。
- 来源：origin/main `3d973f95` → 分支 `amp/cn5-updater-accepted-failure`，[#1531](https://github.com/raydocs/tono/pull/1531)；未合 main。
- 缺陷修复（MAC-UPDATE-ACCEPTED-FAILURE-SILENT）：后台检查（启动 30 s 后、之后每 6 h）弹出更新提示，用户选「安装并重启」，安装包在直连和中继上都下载失败时，
  `check(userInitiated: false)` 的 catch 只看 `userInitiated || nativeUpdatePending`，两者都为假，失败被吞掉，用户的点击没有任何回应 →
  新增 `AppUpdater.reportsFailure(userInitiated:offerAccepted:updatePending:)`：用户接受提示后的失败照常弹出「更新未完成」并写 errorMessage；用户没看到的后台检查仍静默。
- 新增/优化：无。
- 工程与测试：`NativeUpdateCallerTests.testAPackageFailureAfterTheUserAcceptedABackgroundOfferIsShown`（模拟；`check` 本身依赖 helper 与网络，测的是它用的判定）。
- 验证：Swift/XCTest 本机（Linux）不可运行，交由托管 CI（ci-gate）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机。审计另见（未在本 PR 修）：元数据 GET 在第一个中继建连后失败不再试第二个中继；直连已回状态行后变慢不会转中继；三次 GET 之间不记住可用路径。
