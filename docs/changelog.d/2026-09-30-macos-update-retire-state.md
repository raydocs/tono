## 2026-09-30 · macOS：原生更新已释放网络后，退役失败不再保留保护显示

- 归属：G1；macOS App 原生更新重试与保护状态显示。
- 来源：main `ff04bae0` → 分支 `codex2/mac-update-retire-state`；PR 待开；未合 main。
- 缺陷修复：`MAC-UPDATE-RETIRE-STALE-PROTECTION`：helper 已返回 `disconnectVerified == true`，随后 `retire` 写证据归档失败或仍报告 pending 时，App 以前跳过本地保护状态清理，继续显示 Protected Offline。改后在已验证 Disconnect 后立即清 `KillSwitchService.isArmed`、blocked/未知显示和旧重连历史，并递增保护判定序号，使较早启动的 PF 回读不能覆盖释放结果；更新 pending、恢复提示、未完成更新和错误清理仍只在退役成功后提交。
- 新增/优化：无。
- 工程与测试：沿用同文件的闭包传输测试缝模式，给退役方法增加默认 helper 调用参数；现有 `NativeUpdateCallerTests.swift` 新增一个 XCTest `testVerifiedReleaseIsPublishedBeforeFailedRetirementWithoutClearingUpdate`，在退役调用入口及抛错后检查已释放显示，并检查更新记录与 Core 清理标记仍保留。无 helper 或协议版本变更。
- 验证：本 worktree 静态逐行复核 Swift 类型、可选值、闭包、`try await` 与调用方；`git diff --check` 通过。无 Swift/Xcode 或 Windows 环境，未编译、未运行原生平台测试；该 XCTest 由托管 macOS CI 执行，本次未触发 CI、尚无结果。未实机。
- 候选/发布：仅源码，无新候选。
- 剩余限制：helper 容错 Disconnect 可在 Core/DNS 清理未获验证时仍记录 PF 已释放，本次不改该语义；`clearCoreStarted()` 因此仍等退役成功后执行。既有 native suspend/retire 并发所有权问题 `M7424-native-retire-overlap` 未改。
