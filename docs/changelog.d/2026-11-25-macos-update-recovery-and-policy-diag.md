## 2026-11-25 · macOS 更新恢复与策略拒绝诊断补齐
- 归属：ops / 客户更新恢复与诊断（续 #1859–#1863）；仅源码，无新候选；不是 G4 发布。
- 缺陷修复：
  1. **解掉“卡住更新后手动拖新 DMG 永久死锁”陷阱**（`UpdateTransaction.swift`）：`retireUnconsumed` / `retireResolved` 原先只认 `installed == expected`（精确等于旧 `originalComponents` 或目标三件套），导致客户拖入新签名 DMG 覆盖 `/Applications/Tono.app` 后无法退役旧记录、也无法修复 helper。改为新增 `retirementComponentsMatch`：在已验证显式 Disconnect 且系统处于 `unprotected` 的前提下，若 `installedComponents()` 全部通过 Developer ID 签名与 root 归属校验、root 侧 `sing-box` 与 `tono-core-helper` 仍等于预期哈希、且 `/Applications/Tono.app` 的签名封装序号 `installedFloor() >= manifest.releaseSequence`，则允许归档并退役旧记录；降级、未签名或 root 二进制不一致仍拒绝，`highWater` 不回退。
  2. **启动恢复提示对齐界面按钮**（`RuntimeCleanup.swift`、`Localizable.xcstrings`）：新增 `pendingUpdateRecoveryMessage(for:now:)`，当 `AppUpdater.disconnectRetriable` 为假时先引导点击「恢复正常网络」，再走「检查更新 → 断开并重试」，补齐简体中文文案。
  3. **挂起更新期间点击连接不再静默无反应**（`AppState+Connect.swift`）：`userConnect()` 在 `nativeUpdatePending || RuntimeCleanup.nativeUpdateBlocksConnect` 时直接写入 `NativeUpdateDownload.Copy.pendingUnfinished` 错误提示（不影响后台自动 `connect()` 静默守卫）。
  4. **补齐分流策略静默拒绝的审计原因**（`ManagedTrafficPolicyProcessor.swift`、`AppState+Catalog.swift`）：在结构校验与同 revision 冲突/签名替换拒绝点记录闭合词汇表的 `LocalTrafficAudit` 事件（仅 revision 与 reason，不含载荷与账号信息）。
- helper 协议版本：`4.52.75 → 4.52.76`，同步更新 `tooling/scripts/core-helper/CONTRACT.sha256`。
- 风险与不变量：特权更新退役路径。严格保持 U4（不伪造 commit、不降 `highWater`、必须有已验证显式 Disconnect 且 `observe() == .unprotected`）、不放宽降级与签名校验（仅允许签名序号 `>= manifest.releaseSequence` 且 root 二进制未漂移的手工 App 替换）。
- 测试：`UpdateTests` 新增 `resolved-retirement-accepts-newer-signed-app-drag-and-refuses-downgrade-or-core-mismatch`；`NativeUpdateCallerTests` 新增 `testPendingUpdateHintLeadsWithRestoreInternetWhenRetryIsUnavailableAndUserConnectSurfacesError`；`ManagedTrafficPolicyRevisionTests` 新增 `testValidationRejectionReasonClassifiesEnvelopeFailures`。
- 验证：本机运行 `swiftc -parse`、JSON 校验、假 `xcrun` 合约守卫、`test-core-helper-contract-guard.sh` 及 Python/Node 本地测试；Xcode 构建与全量测试交由 hosted `ci-gate`。
- 候选/发布：无新包。
- 剩余限制：未在真机复跑拖 DMG 退役与完整 0.0.87 升级链路。
