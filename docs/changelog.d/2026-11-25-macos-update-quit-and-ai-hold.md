## 2026-11-25 · macOS 原生更新：修复旧 App 永不退出与未保护机器失败后误装 AI 黑洞
- 归属：ops / 客户更新修复（0.0.86 升级失败与断 AI 网根因）；仅源码，无新候选；不是 G4 发布。续 #1862。
- 缺陷修复：
  1. `TonoApp` 使用 `@NSApplicationDelegateAdaptor(AppDelegate.self)`，运行时 `NSApp.delegate` 是 SwiftUI 私有包装器，`NSApp.delegate as? AppDelegate` 恒为 `nil`。导致 `AppUpdater.swift:83` 的 `terminateForNativeUpdate()` 从未执行（100% 触发 30 秒执行器超时），且 `AppSettings.relaunch()` 绕过 `terminateForRelaunch()`。改为由 `TonoApp` 直接传入并记录 `AppDelegate.current`，通过 `AppDelegate.resolve(...)` 获取真实委托，并保留 `NSApp.terminate(nil)` 兜底（普通退出清理已检查 `pendingNativeUpdate()` 不释放 PF）。保留 #1862 的 30 秒 `SIGKILL` 兜底。
  2. `UpdateExecutor.run()` 的 `catch` 分支此前无条件执行 `KillSwitchManager.releaseInstalledBlock()` 与 `SelectiveFailOpenInstaller.applyBestEffort()`，即使更新前本机处于 `unprotected`（未连接或已明确「恢复网络」），也会写入 `retain-ai`、25/26 个 `/etc/resolver/*` (`192.0.2.1`) 与两条 Anthropic `BLACKHOLE` 路由，违反决策 125（#1293 第 4 项）。改为 `UpdateExecutor.aiHoldOwed` + `releaseAfterFailure`：仅在保护已武装、PF 活跃/不可读或已有 `retain-ai`/不可读意图时保留 AI 拦截；未欠拦截时仅做普通 PF/DNS 清理，不新装也不误删既有拦截；严格模式不释放。
- helper 协议版本：`4.52.74 → 4.52.75`，同步更新 `tooling/scripts/core-helper/CONTRACT.sha256`。
- 风险与不变量：特权路径、PF/DNS 故障切换与更新生命周期。不放宽已武装会话的 fail-closed 或崩溃/更新失败后的 AI 拦截保留（`M4-UPDATE-SELECTIVE-OMISSION`）；未知 PF/意图状态保守视为欠拦截；严格模式保持不释放。
- 测试：`NativeUpdateCallerTests.testAppDelegateResolveFindsRealDelegateBehindSwiftUIWrapper`；`UpdateTests` 新增 `failed-update-installs-ai-hold-only-when-owed`。
- 验证：本机运行 `swiftc -parse`、假 `xcrun` 合约守卫、`test-core-helper-contract-guard.sh` 及 Python/Node 非编译守卫；Xcode 构建、`macos / unit-tests`、`macos / helper`、`macos / privileged-tests` 交由 hosted `ci-gate`。
- 候选/发布：无新包（发 0.0.87 需按 SHIP_PLAN 门禁走发布流程）。
- 剩余限制：未在真机复跑完整升级链路；已卡住且未升级的客户端需先退出/恢复网络或等后续新包。
