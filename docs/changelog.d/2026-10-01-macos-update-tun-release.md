## 2026-10-01 · macOS 待更新时隧道丢失不再放开保护
- 归属：SHIP_PLAN §2 item 10；`AppState+Connect.swift`；发现 MAC-UPDATE-TUN-RELEASE。
- 来源：基线 `17580a26` → 分支 `hunt/grok-maccfg-update-tun-release-89a9`（#891），未合 main。
- 缺陷修复：`installNativeUpdate` 在 `stage()` 之前就把 `nativeUpdatePending` 设为真，监控要到 `suspend()` 才取消。这中间隧道被判定丢失时，`disconnect(releaseKillSwitch: true)` 会调用 `disconnectPendingNativeUpdate`，放开 PF 并置 `nativeUpdateBlocksConnect`，助手流量直连且之后的连接不会恢复保护。现在只有核心监控的缺失隧道判决带 `exhaustedTunnelLoss`，这条路径在更新仍 pending 时直接返回，不放开。用户的 Restore internet 仍走原来的放开。
- 新增/优化：无。
- 工程与测试：`AppStateConnectRecoveryTests.testExhaustedTunnelLossLeavesPendingNativeUpdateArmed`。
- 验证：Linux 云代理无 Swift 工具链，XCTest 未在本地执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需 `needs-hardware`。选择性只拦助手、其余放行的钩子仍是 `selectiveAiBlockReady = false`，本修复不打开它。
