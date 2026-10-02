## 2026-10-02 · macOS：网络变化会重启等待中的未上锁重连
- 归属：SHIP_PLAN §2 第 10 项；macOS App（`AppState.handleSystemNetworkChange`、`scheduleUnarmedReconnect`、`ConnectionCoordinator`）。
- 来源：基线 `0c4c07bc` → 分支 `fix/mac-unarmed-network-kick`，PR #1346；尚未合入 main。
- 缺陷修复：自动放行后的未上锁重连循环退避到 120 秒一探时，网络恢复或开盖换网不会叫醒它，最长要再等约 2 分钟
  才重新连接。现在系统网络变化会让仍在等待的循环从第一档（2 秒）重新开始。关联 MAC-UNARMED-NO-NETWORK-KICK。
- 新增/优化：无。循环仍然不上锁、不建隧道；已上锁、已暂停等用户操作、意外重启后等用户操作、待更新时不重启；被新一代操作取代的循环
  不会被复活；重启后到首探之间的后续网络变化不再推后首探。循环自身在探测前和连接前也检查「意外重启后只由用户重连」
  （原先没有检查，评审指出）。
- 工程与测试修正：`ConnectionCoordinator.unarmedReconnectOwner` 记录仍在等待的循环和它所属的代（结束的循环会留下任务句柄，
  句柄说明不了它是否还活着）。回归 `testNetworkChangeRestartsAWaitingUnarmedReconnect` 先单独推送为 `4e6f8a84`（红），结果记在 PR。
- 验证：仅托管 CI（XCTest）；未在 Mac 实机上断网再恢复。仅源码，无新候选。

### 2026-10-02 续记：已合 main
- 来源合入：#1346，merge commit `32fb4576`，PR 头 `bb65de77`。该头的 `ci-gate` 全绿：https://github.com/raydocs/tono/actions/runs/37036778230 。红测试 `4e6f8a84`：run 37035620685（`macos / build` XCTest 失败）。
- 独立评审：Codex `gpt-6.1-sol`（high）两轮；第一轮 1 个 major（未遵守意外重启后的暂停）和 2 个 minor 已在 `bb65de77` 修正；第二轮无 major，1 个测试夹具 minor 记在 PR limitations；记录在 https://github.com/raydocs/tono/pull/1346#issuecomment-5957337103 。
- 候选/发布：仅源码合入 main。无新安装包，无部署，无客户发布。没有实机验证。
