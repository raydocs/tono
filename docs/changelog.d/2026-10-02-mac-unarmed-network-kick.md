## 2026-10-02 · macOS：网络变化会重启等待中的未上锁重连
- 归属：SHIP_PLAN §2 第 10 项；macOS App（`AppState.handleSystemNetworkChange`、`scheduleUnarmedReconnect`、`ConnectionCoordinator`）。
- 来源：基线 `0c4c07bc` → 分支 `fix/mac-unarmed-network-kick`，PR #1346；尚未合入 main。
- 缺陷修复：自动放行后的未上锁重连循环退避到 120 秒一探时，网络恢复或开盖换网不会叫醒它，最长要再等约 2 分钟
  才重新连接。现在系统网络变化会让仍在等待的循环从第一档（2 秒）重新开始。关联 MAC-UNARMED-NO-NETWORK-KICK。
- 新增/优化：无。循环仍然不上锁、不建隧道；已上锁、已暂停等用户操作、待更新时不重启；被新一代操作取代的循环不会被复活。
- 工程与测试修正：`ConnectionCoordinator.unarmedReconnectOwner` 记录仍在等待的循环和它所属的代（结束的循环会留下任务句柄，
  句柄说明不了它是否还活着）。回归 `testNetworkChangeRestartsAWaitingUnarmedReconnect` 先单独推送为 `4e6f8a84`（红），结果记在 PR。
- 验证：仅托管 CI（XCTest）；未在 Mac 实机上断网再恢复。仅源码，无新候选。
