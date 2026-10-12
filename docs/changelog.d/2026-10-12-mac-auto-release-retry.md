## 2026-10-12 · macOS：失败的自动释放由下一次网络变化或唤醒重试
- 归属：SHIP_PLAN §2 item 10 「连不上且无下一手」；macOS 连接 FSM / PF 释放语义。
- 来源：基线 main fd438f627 → 实现源码见 PR [#1592](https://github.com/raydocs/tono/pull/1592)；分支 `claude/wifi-switch-mac-auto-release-retry`；未合 main。
- 缺陷修复：客户切换 Wi-Fi 后 Mac 没有网络，直到卸载 Tono。原失败场景：网络变化后受保护重连耗尽，`applyExhaustedArmedFailure` 的自动释放
  （`disconnect(releaseKillSwitch: true, automaticFailureRelease: true)`）本身失败（helper 修复、DNS 恢复或 disarm 出错），PF 仍 armed、停在 Protected Offline；
  `ConnectionCoordinator` 对 `.automatic` 也保留释放意图，于是 `handleSystemNetworkChange` 与唤醒路径都当成「用户的 Restore internet」跳过，未 armed 循环又因 PF armed 退出，
  没有任何自动重试。改后：协调器额外记录保留意图的来源（`disconnectQueueRequestsAutomaticRelease`），保留的是自动释放且无释放在途时，
  下一次系统网络变化或唤醒重跑同一个自动释放（保留 AI hold，成功后照常调度未 armed 重连；不重复上报 failOpen 遥测）。用户自己的 Restore internet 仍保留意图、不被重试（X1-2 不变）。
  不动：A29 受保护故障保持（重试入口与 `applyExhaustedArmedFailure` 都先看 `holdsProtectedFault`）、strict、PF 规则、helper、`HelperProtocolVersion`、未 armed 循环的退避。
  记录：[MAC-AUTO-RELEASE-FAIL-NO-RETRY](../findings.d/MAC-AUTO-RELEASE-FAIL-NO-RETRY.md)。
- DNS / PF 顺序（所有者约束：释放必须先把系统 DNS 还给用户原来的家宽解析器，PF 仍 armed 时不得有 DNS 从物理接口出去）：重试走同一条
  `disconnect(releaseKillSwitch: true, automaticFailureRelease: true)`，未新增释放路径。`AppState+Connect.swift` 中 `restoreDNS()`（约 1195 行）先于 PF 释放；
  `disarming = releaseKillSwitch && coreStopped && protectedDNSRestored`（约 1241 行）才会走 `releaseAfterFailure()`（约 1251 行）；DNS 恢复失败时
  `disarming` 为假，只走 `restrictToBootstrap()`（约 1256 行）保持 PF armed 并保留未确认意图。所以重试若再次卡在 DNS 步骤，PF 仍 armed、DNS 不会在网络放开时留在 127.0.0.1，
  也不会 PF 放开而 DNS 未还原。
- 新增/优化：无。
- 工程与测试：新增 `AppStateSleepTests.testFailedAutomaticReleaseIsRetriedByTheNextNetworkChange`（首次释放在 disarm 失败，网络变化后重试在 DNS 恢复步骤再失败：断言释放被重跑、`releaseAfterFailure` 未再调用、PF 仍 armed）；原 `testSleepGateRefusedReleaseDoesNotReconnectOnWake` 继续覆盖用户释放不被重试。
- 验证：本机不运行 xcodebuild；由 PR #1592 的 hosted `ci-gate` 验证（先仅测试的失败，再修复后的结果，见 PR 正文）。无实机测试。
- 候选/发布：无新包，仅源码。
- 剩余限制：高风险（释放语义 + 连接 FSM），合并前需独立 Codex 评审；待实机（切换 Wi-Fi 后自动释放失败再恢复）。
  每次网络变化都会重跑一次释放，helper 修复若需要管理员授权则可能再次弹出授权框。
