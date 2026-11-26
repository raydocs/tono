## 2026-11-25 · macOS 加固：更新失败保守 PF 探测区分空子 anchor，以及更新交接退出专用栅栏
- 归属：macOS 客户端与 helper（`4.52.76 → 4.52.77`），仅源码与测试；不是 G4 发布。
- 变更：
  1. `KillSwitchPF.swift` + `UpdateExecutor.swift`：新增 `effectiveStatusConservative`，将 `pfctl` 真实失败/不可读视为未知以保守保留 AI hold，同时通过 `pfctl -sA` 及 `"anchor does not exist"` 区分「外部启用 PF 但 Tono 子 anchor 已清空/不存在」，避免未保护 Mac 更新失败误装 AI 黑洞。
  2. `AppDelegate.swift` + `AppUpdater.swift`：新增专用单向交接标记 `AppDelegate.nativeUpdateTerminationRequested`（在 `AppUpdater` 消费成功后、调用 `NSApp.terminate(nil)` 前置位），在 `finishTerminationCleanup()` 和 `applicationWillTerminate(_:)` 作为第二道栅栏跳过普通 PF 释放；不复用 `RuntimeCleanup.nativeUpdatePending`，保证普通 `Cmd+Q` 仍可向 helper 核验并清理过期更新门控。
  3. 同步更新 `HelperProtocolVersion` 至 `4.52.77` 并重算 `CONTRACT.sha256`。
- 测试：`UpdateTests` 覆盖 `effectiveStatusConservative` 的失败/外部 PF 空 anchor/竞态 absent/权限失败/活跃规则 5 种情况；`NativeUpdateCallerTests` 新增 `testNativeUpdateTerminationFenceIsIndependentOfStalePendingHint`。本地已跑 `swiftc -parse`、`test-core-helper-contract-guard.sh` 及假 `xcrun` 校验；未跑本地 `xcodebuild`，由托管 `ci-gate` 验证。
