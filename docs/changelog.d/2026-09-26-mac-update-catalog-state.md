## 2026-09-26 · macOS：原生更新断开/准备失败与目录移除横幅按真实保护状态显示
- 归属：G1；macOS App `AppState+NativeUpdate.swift`、`AppState+Catalog.swift`。Part of [#601](https://github.com/raydocs/tono/issues/601)。
- 来源：基线 origin/main `3470dd68`；红分支 `wip/mac-update-catalog-state-20260926-red`（`0879264c`），修复分支
  `fix/mac-update-catalog-state-20260926`，[#649](https://github.com/raydocs/tono/pull/649)；未合 main。
- 缺陷修复：
  - TM-claude-1-native-update：原生更新「已验证断开」与「退役重试」放开连接时不清 `consecutiveProtectionRepairCount`，
    旧的保护修复计数会带进下一次会话，一次修复就可能触发「连续三次」暂停。改后两条路径与普通放开调用同一个
    `resetReleasedSessionHistory()`（从 `disconnect(releaseKillSwitch: true)` 抽出），清零的是同一组失败/重连历史。
  - H16-O-F4：原生更新准备失败时挂起已清 `isConnected`，但 `isProtectionBlocked` 未设，PF 仍 armed 而各表面显示 Standby、
    Connect 被静默丢弃。改后：未连接且 Kill Switch 仍 armed（或 helper 报告待恢复且不是 unprotected）时置
    `isProtectionBlocked = true`；只会升起，不放开任何屏障。
  - H16-O-F3：所选服务器被移出目录且无托管默认时，横幅固定说「Kill Switch 仍在拦截」。改后按 `isProtectionBlocked ||
    KillSwitchService.isArmed` 选文案；空闲未 armed 时改为「所选云端节点已被移除，请另选一个云端节点」（新增 zh-Hans 译文）。
- 新增/优化：无。
- 工程与测试：新增 XCTest `testFailedPreparationWithArmedBarrierReadsAsBlocked`（NativeUpdateCallerTests）与
  `testRemovedSelectionOnUnarmedMacDoesNotClaimKillSwitchBlocks`（MacUsabilityTests）。TM-claude-1 未加测试：断开/退役
  直接调用 `PrivilegedRuntimeCoordinator.shared` 的 helper 通道，没有测试缝，为此新开特权通道注入面不划算。
- 验证：未在本地编译或运行（MacBook 不是构建机）；以 macOS CI 为准，提交时尚未出结果。红分支只含测试，应按断言失败。
- 候选/发布：仅源码，无新候选。
- 续记 2026-09-26：审查 2a54be9b 两条 minor 已改——放开历史清零抽成共用 helper；横幅测试改为比对完整本地化字符串。
  H16-O-F3/F4 改为更新总账原行（删去新建分片），TM-claude-1-native-update 保留分片。
- 剩余限制：计数清零无回归测试，靠审查确认；准备失败的实际频率仍需实机。
