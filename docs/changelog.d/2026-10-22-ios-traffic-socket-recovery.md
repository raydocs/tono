## 2026-10-22 · iOS 统计 socket 独立恢复与会话隔离
- 归属：ops plan §P2「Android / iOS 客户端」；不属 SHIP_PLAN 0.0.75，不推进 G1–G4；保持 draft。
- 来源：`d1232520a742b3e747f7b9a228361d696f24a172` → 分支 `t3/ios-traffic-monitor-retry`（本 PR）；未合 main。
- 缺陷修复：连接失败/断开后仅清空客户端 → 统计自行退避恢复，不重启隧道、不改变确认/保护状态。已停止的统计 run 及旧实例、NE 会话的回调不能发布旧速率或自行重试；AppModel 迟到 connected 另开统计 run 的 P3 仍未解决（见下方续记）。见 `IOS-TRAFFIC-SOCKET-RECOVERY`。
- 新增/优化：无产品能力新增；统计失败清零，退避 1 秒起、30 秒封顶，收到新统计后复位；始终只有一个统计连接/待重试。
- 工程与测试：注入连接工厂、可取消时钟、主线程交付与 serial queue。独立 harness 编译真实 `App/Services/TrafficMonitor.swift`，Libbox shim 仅提供签名，默认连接一旦被误调用即失败；9 个窄回归，无真实时钟重试等待。`ios-ci.yml` 的 macOS job 运行同一脚本。
- 验证：Devin macOS 会话 `bd5233898e6b48a6a5f8a87afd30ff48`，仅抽取依赖、保留旧生命周期的 `320bc9e84aeedbb0a70e05e6f6c2c65a2bc7df03`：`testConnectFailureRetriesWithoutAnotherTunnelStatus` 编译成功后 `Executed 1 test, with 1 failure`，重试计数实际 0、应为 1。原始 `traffic-red.log` 附于该会话；修复 head 的 GREEN/构建命令、准确 SHA 与日志见本 PR 的验证评论，不把 shim 通过当作真实 NE 验证。
- 候选/发布：仅源码，无新包、无新候选、未签名、未部署或发布。
- 剩余限制：未在本机运行任何原生构建/测试；签名真机的健康隧道下统计 socket 失败/断开、登出与会话切换未验证；同步 native connect 只能在返回后关闭。高风险生命周期独立审查由父线程完成，未完成前不得合并/部署。

### 2026-10-22 · PR #1715 一轮 P3 续记（未修复，按范围兜底）
- 独立审查已覆盖 `cf5c919867d55237edec8ab692e2b1a2d683ea12`，结论 `approve-with-fixes`；原生 worker fencing/backoff/API/harness 通过，留下预存 P3：`AppModel.swift:379/800` 首次连接时本地 NE 仍为 invalid/disconnected，Cancel 使 `userStopping=false`，迟到 connected 可另开统计 run。不能据此声称修复真实取消隧道。
- 完整入口复核：App 内 Connect 经 `AppModel.connect`；widget / Live Activity / Control Center 经 `SetTunnelIntent.perform` → App 的 `TunnelCommand.set` → 共享 `TunnelStartCoordinator`，绕过 AppModel。NE 通知与前台 load 仅交付 status/connectedDate；合法 OnDemand 重连也走相同通知。
- 范围内不能可靠解锁：只在 AppModel 锁存到下次本地 Connect，会阻断外部显式启动后的统计恢复；只看 connectedDate（首次尚无旧日期）不能区分迟到 connected 与新会话；只看 coordinator 的公开 generation 也不够，start/stop/remove/cancelPendingStart 都递增，意图 `latestIsStart` 私有。不能把任意 generation 变化当成显式启动，也不能用 wantOn 为合法 OnDemand 恢复加门。
- 处理：依任务兜底保留 P3 为 open residual，只续记现有 changelog/finding/PR body；未改 AppModel、生产接缝、harness、wantOn、NE 或保护语义。安全修复需另行界定跨入口的可观测显式启动/停止意图与会话关联，超出本轮统计局部修正，不猜测解锁。
- 验证：本轮仅文档；`git diff --check`。沿用原 Devin 会话 `bd5233898e6b48a6a5f8a87afd30ff48` 的旧重试 RED 与 `cf5c919867d55237edec8ab692e2b1a2d683ea12` 1/1、9/9 GREEN、真实 pinned Libbox unsigned iphoneos Release `BUILD SUCCEEDED`；已重新读取原始日志关键断言/计数/构建结果。不将这些证据记作本 P3 的 RED/GREEN 或新 head 的重跑。
- 未跑/剩余风险：未新增目标时序回归（没有可安全接入的生产意图接缝）、未运行新的云端/本地原生检查、未做签名真机 NE/socket 验证；P3 未关闭。无新包、无委派、无合并/部署/监控；由父线程作最终风险处置，本文不构成最终审批。

### 2026-10-22 · PR #1715 P3 扩围续修（统计意图接缝）
- 用户明确继续修复，允许必要的跨入口统计意图关联；先前 open residual 记录为当时范围决策，不作当前修复通过证据。
- 最小接缝：coordinator 只读 `statisticsStartEpoch`（初次 load/进程重启为继承 0；最新显式 start 为该 generation；stop/remove/cancelPendingStart 为 nil）。不改 coordinator 切换步骤、队列、wantOn 或 NE/保护行为。
- 生产 `TrafficMonitor.updateTunnel` 从 AppModel 抽出原统计准入；改由 account gate + 共享显式 start epoch 准入，而非会被 disconnected/invalid 清掉的 `userStopping`。nil 停止意图不被 NE/load 解锁；新 start epoch 即使 connectedDate 相同也作废旧统计 run，OnDemand 仍沿用最新 start epoch 并按 NE 日期换会话。
- 一个窄时序回归编译真实生产 seam、coordinator 和 worker，OS 操作及统计连接/时钟注入；无复制准入算法。旧准入 RED fixture 为 `e535793e4b7d8251c5504e85deb1ab6d9a79e6b3`（仅抽取接缝，不是 untouched baseline），先运行后修复；原始证据待云端返回，不将原 9 测试当作 P3 证明。
- 未跑：新 P3 RED/GREEN、真实 Libbox 编译、签名真机 NE/socket 时序；不合并/部署/监控，新增 delta 待父线程独立审查。
