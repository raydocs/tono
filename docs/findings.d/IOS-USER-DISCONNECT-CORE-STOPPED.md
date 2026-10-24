| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-USER-DISCONNECT-CORE-STOPPED | iOS 用户主动断开时 App 先发 libbox `serviceClose()`，扩展经 `serviceStop` 记为 CORE_STOPPED 并带错取消，App 回前台与小组件显示「连接已断开/重试」 | in-PR | 待开（fix/t1-ios-state） | 高·源码推导；TonoKit 场景回归在旧行为上失败 | 已去掉多余 `serviceClose()`，provider 停止中的 service 关闭不再记失败，App 意图账本与共享状态读取按用户意图优先；libbox 是否在 `closeService()` 中回调 `serviceStop` 未在真实 NE 验证；真机未验证 |

证据（修复前，main 322f48c6f）：`apps/ios/App/Services/TunnelController.swift:217-221`（`serviceClose()` 后 `stopVPNTunnel()`）→
`apps/ios/PacketTunnel/TunnelPlatform.swift:239-241`（`serviceStop()` 无条件 `coreStopped()`）→
`apps/ios/PacketTunnel/PacketTunnelProvider.swift:294-304`（记 CORE_STOPPED 并 `cancelTunnelWithError`）；
`apps/ios/TonoKit/Sources/TonoKit/SharedStatus.swift:183-192`（`governs()` 让更晚的负面报告胜过 off 便签）；
`apps/ios/App/Model/AppModel.swift:221-224`（回前台采纳文件里的失败）。来源：Antigravity 三方审查 P1。
回归：`StateIntentTests.testEveryScenarioShowsTheUsersIntentOrTheRealFailure` 的「user disconnect」两行。
`docs/agent-reports/2026-10-19-ios-r12-receipts/stubs/LibboxStub.swift` 属已签收收据（SHA256SUMS），未改。
