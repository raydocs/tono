## 2026-10-22 · iOS 统计 socket 独立恢复与会话隔离
- 归属：ops plan §P2「Android / iOS 客户端」；不属 SHIP_PLAN 0.0.75，不推进 G1–G4；保持 draft。
- 来源：`d1232520a742b3e747f7b9a228361d696f24a172` → 分支 `t3/ios-traffic-monitor-retry`（本 PR）；未合 main。
- 缺陷修复：连接失败/断开后仅清空客户端 → 统计自行退避恢复，不重启隧道、不改变确认/保护状态。旧实例、停止、登出、NE 会话切换后的回调不得恢复客户端或旧速率。见 `IOS-TRAFFIC-SOCKET-RECOVERY`。
- 新增/优化：无产品能力新增；统计失败清零，退避 1 秒起、30 秒封顶，收到新统计后复位；始终只有一个统计连接/待重试。
- 工程与测试：注入连接工厂、可取消时钟、主线程交付与 serial queue。独立 harness 编译真实 `App/Services/TrafficMonitor.swift`，Libbox shim 仅提供签名，默认连接一旦被误调用即失败；9 个窄回归，无真实时钟重试等待。`ios-ci.yml` 的 macOS job 运行同一脚本。
- 验证：Devin macOS 会话 `bd5233898e6b48a6a5f8a87afd30ff48`，仅抽取依赖、保留旧生命周期的 `320bc9e84aeedbb0a70e05e6f6c2c65a2bc7df03`：`testConnectFailureRetriesWithoutAnotherTunnelStatus` 编译成功后 `Executed 1 test, with 1 failure`，重试计数实际 0、应为 1。原始 `traffic-red.log` 附于该会话；修复 head 的 GREEN/构建命令、准确 SHA 与日志见本 PR 的验证评论，不把 shim 通过当作真实 NE 验证。
- 候选/发布：仅源码，无新包、无新候选、未签名、未部署或发布。
- 剩余限制：未在本机运行任何原生构建/测试；签名真机的健康隧道下统计 socket 失败/断开、登出与会话切换未验证；同步 native connect 只能在返回后关闭。高风险生命周期独立审查由父线程完成，未完成前不得合并/部署。
