## 2026-10-12 · macOS：失败的自动释放由下一次网络变化或唤醒重试
- 归属：SHIP_PLAN §2 item 10 「连不上且无下一手」；macOS 连接 FSM / PF 释放语义。
- 来源：基线 main fd438f627 → 实现源码见 PR [#1592](https://github.com/raydocs/tono/pull/1592)；分支 `claude/wifi-switch-mac-auto-release-retry`；未合 main。
- 缺陷修复：客户切换 Wi-Fi 后 Mac 没有网络，直到卸载 Tono。原失败场景：网络变化后受保护重连耗尽，`applyExhaustedArmedFailure` 的自动释放
  （`disconnect(releaseKillSwitch: true, automaticFailureRelease: true)`）本身失败（helper 修复、DNS 恢复或 disarm 出错），PF 仍 armed、停在 Protected Offline；
  `ConnectionCoordinator` 对 `.automatic` 也保留释放意图，于是 `handleSystemNetworkChange` 与唤醒路径都当成「用户的 Restore internet」跳过，未 armed 循环又因 PF armed 退出，
  没有任何自动重试。改后：协调器记录保留意图的来源与恢复策略（`RetainedRelease`，见续记），保留的是自动释放且无释放在途时，
  下一次系统网络变化或唤醒重跑同一个自动释放（保留 AI hold，成功后照常调度未 armed 重连；不重复上报 failOpen 遥测）。用户自己的 Restore internet 仍保留意图、不被重试（X1-2 不变）。
  不动：A29 受保护故障保持（重试入口与 `applyExhaustedArmedFailure` 都先看 `holdsProtectedFault`）、strict、PF 规则、helper、`HelperProtocolVersion`、未 armed 循环的退避。
  记录：[MAC-AUTO-RELEASE-FAIL-NO-RETRY](../findings.d/MAC-AUTO-RELEASE-FAIL-NO-RETRY.md)。
- DNS / PF 顺序（所有者约束：释放必须先把系统 DNS 还给用户原来的家宽解析器，PF 仍 armed 时不得有 DNS 从物理接口出去）：重试走同一条
  `disconnect(releaseKillSwitch: true, automaticFailureRelease: true)`，未新增释放路径。`restoreDNS()`（`AppState+Connect.swift:1212`）先于 PF 释放；
  `disarming = releaseKillSwitch && coreStopped && protectedDNSRestored`（:1258）才会走 `releaseAfterFailure()`（:1268）；DNS 恢复失败时
  `disarming` 为假，只走 `restrictToBootstrap()`（:1273）保持 PF armed 并保留未确认意图。所以重试若再次卡在 DNS 步骤，PF 仍 armed、DNS 不会在网络放开时留在 127.0.0.1，
  也不会 PF 放开而 DNS 未还原。
- 新增/优化：无。
- 工程与测试：`AppStateSleepTests` 的 `testFailedAutomaticReleaseIsRetriedByTheNextNetworkChange`（首次释放失败，网络变化后重试在 DNS 恢复步骤再失败：断言释放被重跑、`releaseAfterFailure` 未再调用、PF 仍 armed）；原 `testSleepGateRefusedReleaseDoesNotReconnectOnWake` 继续覆盖用户释放不被重试。
- 验证：本机不运行 xcodebuild；由 PR #1592 的 hosted `ci-gate` 验证（先仅测试的失败，再修复后的结果，见 PR 正文）。无实机测试。
- 候选/发布：无新包，仅源码。
- 剩余限制：高风险（释放语义 + 连接 FSM），合并前需独立 Codex 评审；待实机（切换 Wi-Fi 后自动释放失败再恢复）。
  （第 1 版曾写“每次网络变化重跑释放、可能再弹授权框”，已由下面第 1 轮续记作废：重试不再弹授权框，且有冷却。）

### 续记 2026-10-12 · Codex 评审第 1 轮（对 1b1441aa，FAIL：4 major、1 minor）与修复
- 评审发现与处理：
  1. 更新闸门只在建 Task 前检查，且漏了 `RuntimeCleanup.nativeUpdatePending`：现在入口与 Task 运行时都读 `automaticReleaseRetryMayRun`
     （本地/helper 侧更新闸门 + A29 故障 + 仍待重试），先开始的更新使排队的重试作废。测试 `testUpdateStartingBeforeTheQueuedRetryRetiresIt`。
  2. 重复管理员授权框：重试 `disconnect(..., interactiveRepair: false)`，不调用会弹框的 `repairForRelease`，改用只读探测
     `PrivilegedRuntimeCoordinator.explicitReleaseRepairIsRequired()`；需要修复、授权被拒、helper 被拒或属于其他账号时，
     在保留意图上记 `needsUserRepair`，之后不再自动重试，直到用户的新请求 / Connect；另加每 20 秒最多一次的冷却。
     没有沿用 `protectedReconnectPausedForUserAction`：暂停 / 重启保持类的释放本来就带着该暂停，用它做闸门会让它们永远无法重试。
     测试 `testDeniedAdministratorRepairIsNotRetriedByTheNextNetworkChange`、`testRetryNeverPromptsForHelperRepairAndStopsUntilTheUserActs`、`testNetworkChangeBurstRetriesTheAutomaticReleaseOnce`。
  3. `.automatic` 来源丢了原来的「不自动重连」策略：保留意图同时记录原释放的 `resumesWhenReleased`（`applyExhaustedArmedFailure` 的 `resumeWhenReachable`；
     其他自动释放入口默认 false），重试沿用它，暂停 / 重启保持 / 用户动作类释放只会被重试为释放，不会因此获得重连。测试 `testReleaseHeldForTheUserIsRetriedAsReleaseOnly`。
  4. 重试后仅在释放已确认（PF 未 armed 且不再 Protected Offline）时才调度未 armed 重连；重试 Task 先等它自己排的拆除队列完成再判断。
     测试 `testUnconfirmedRetryDoesNotScheduleTheUnarmedReconnect`。
  5. 三处清除 `disconnectQueueReleaseIntent` 而漏掉来源：保留意图改为一个 `RetainedRelease?`（来源 + 恢复策略 + 是否等用户），清除即整体置 nil。
- 覆盖补充：唤醒路径重试 `testFailedAutomaticReleaseIsRetriedByWake`；用户释放不被重试：`testSleepGateRefusedReleaseDoesNotReconnectOnWake` 直接断言 `disarm` 只调用一次且无重试任务。
- 仍不动：A29 守卫、strict、PF 规则、helper、`HelperProtocolVersion`、未 armed 循环退避。
- 新的剩余限制：其他自动释放入口（目录移除、代理、重启保持等）失败后只会被重试为释放，不会带重连，需要用户 Connect；重试期间若 helper 需要修复，要等用户点 Restore internet。

### 续记 2026-10-12 · Codex 复核第 2 轮（对 c575d9bb：第 1 轮五项均已解决；新增 1 major、1 minor）
- MAJOR（冷却丢事件）：20 秒冷却把冷却内的网络变化 / 唤醒直接丢掉（唤醒还不会落到原来的唤醒恢复）。瞬时失败后网络恢复、不再有通知，Mac 会一直 armed 到用户点击；
  已停止的连接态核心监视器也不会兜底。改为合并而不是丢弃：冷却内的事件只留一个延后重试（`automaticReleaseDeferredRetry`，单飞、冷却结束时触发），
  触发时经同一入口重新读取 `automaticReleaseRetryMayRun` 与保留意图，所以更新 / A29 故障 / 用户已操作都会让它作废；唤醒同样合并，不再被吞。
  自循环防护：重试在途时（含它自己拆除产生的 DNS / PF 通知）事件不算数；重试结束后 `automaticReleaseRetryEchoSettle`（3 秒）内的网络通知按回声忽略，唤醒不受此限；
  冷却和回声窗口是实例属性，供测试缩短。测试 `testNetworkEventInsideTheCooldownIsDeferredNotDropped`、`testWakeInsideTheCooldownIsDeferredNotDropped`、`testARetrysOwnNotificationsDoNotScheduleAnotherRetry`。
- MINOR（过期说明）：剩余限制里“每次网络变化重跑并可能再弹授权框”已改成对第 1 版的历史说明。
- 新的剩余限制：失败的释放最坏每 20 秒由真实事件重试一次（不会无事件自循环）；回声窗口按时间判断，不比较网络状态。
