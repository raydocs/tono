## 2026-11-25 · macOS 修复：抢占式恢复网络后不清除 AI 恢复提示，以及首页重复「恢复正常网络」按钮
- 归属：macOS 客户端源码（`apps/macos/Tono/` + `TonoTests`），无 helper 协议变更；不是 G4 发布。
- 真机复现（`0.0.87` build `88` 候选包 + `cua-driver` 实测）：
  1. 在装有独立 `tono-release` 服务的真实 Mac 上点「恢复正常网络」走 `restoreInternetPreemptively()` → `finishPreemptiveRelease()`，即使返回 `outcome=restored` 且 `ai=restored/settled`，`selectiveAIRecoveryPending` 从未置回 `false`，导致黄色「AI 恢复规则可能仍在生效」提示常驻不消（XCTest 环境没有 `/var/run/tono-release.sock` 走了旧 `disconnect()` 回退路径所以没拦住）。
  2. 当 `selectiveAIRecoveryPending == true` 且首页同时显示失败重试行（`seaAttentionActions`）或断开/拦截行时，`DashboardView` 会上下堆叠两个完全相同的「恢复正常网络」按钮，且中文提示文案写着「恢复互联网」与按钮不一致。
  3. 同步说明：紧急命令 `--emergency-disarm` 后首次连接出现 `TONO_RELEASE_UNFINISHED` 是 R-M2 设计不变量（要求在紧急解除后跑一次带回读证明的「恢复正常网络」才能重新建连），本次严格保留该不变量。
- 修复：
  - `AppState+Connect.swift`：`finishPreemptiveRelease` 根据 `ai` 分项回读结果及 `restored` 结论更新 `selectiveAIRecoveryPending`（`ai=restored` 或 `outcome=restored` 置 `false`，`ai=residual` 置 `true`，`busy`/`superseded` 保持不动）；`onCoreStarted` 建连成功后同步清除 `selectiveAIRecoveryPending`。
  - `DashboardView.swift` + `Localizable.xcstrings`：新增纯函数 `showsInlineSelectiveAIRecoveryButton(...)`，仅在没有其他「恢复正常网络」操作可见时才在提示内渲染按钮，并统一中文文案为「恢复正常网络」。
- 测试：`PreemptiveReleaseSessionTests` 新增两条单测覆盖 `finishPreemptiveRelease` 各结果与 `showsInlineSelectiveAIRecoveryButton` 全状态；本地已跑 `swiftc -parse` 与 JSON 校验；未在本地跑 `xcodebuild`，由托管 `ci-gate` 验证。
