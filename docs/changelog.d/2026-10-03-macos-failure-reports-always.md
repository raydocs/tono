## 2026-10-03 · macOS：连接失败和保护丢失始终上报，开关只管快照和错误原文
- 归属：SHIP_PLAN G2（失败可见）；macOS 客户端（`AccountSession.swift`、`AccountSession+Telemetry.swift`、`SettingsView.swift`）。
- 来源：基线 `eb363310` → 分支 `fix/macos-failure-reports-always-20261003`；尚未合入 main。
- 缺陷修复：无。
- 新增/优化：所有者 2026-10-03 决定（决策 051，取代 050 的「关闭后不发」）。正式版在「保护快照」关闭时也发送分类的连接失败报告（阶段、错误码、节点、版本，不含错误原文和 Core 日志）；保护丢失事件始终入队、始终发送。定期上传任务在登录后一直运行：开关关闭时每轮只把队列里的失败和保护丢失报告发出去，不发时间线。关闭开关时丢掉队列里的时间线和失败正文（可能带错误原文），保留保护丢失事件。设置文案改成如实说明。
- 工程与测试修正：回归 `testANetworkLossReportIsQueuedWhileTheSnapshotIsOff`、`testAReleaseBuildReportsClassifiedFailuresWithTheSnapshotOff` 先单独推送为红（`af08a861`）。
- 验证：仅托管 CI（XCTest）；本机只有 `swiftc -parse`。没有实机验证。仅源码，无新候选。生产还没有 `failure_clusters`（迁移 0093 未部署），保护丢失事件会存下来但不会告警。
