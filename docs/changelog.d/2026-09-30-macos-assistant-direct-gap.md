## 2026-09-30 · macOS 助手目的地先于托管直连
- 归属：SHIP_PLAN §2 item 10；macOS `ConfigPipeline+SingBoxProduct.swift` 与 `ConfigPipeline+Runtime.swift`；发现 MAC-ASSISTANT-DIRECT-GAP。
- 来源：基线 `50bbbbf0` → 分支 `hunt/grok-maccfg-assistant-direct-guard-89a9`（#867），未合 main。
- 缺陷修复：没有住宅跳时，sing-box 与 mihomo 生成器都不发出助手域名和 `160.79.104.0/21` 规则，理由是最终 MATCH 会把它们送进出口。已审核应用的进程直连和网页后缀直连是先匹配，会先于 MATCH 把这些目的地送出物理网卡。有住宅跳时域名规则只写了 TCP，同一进程的 UDP 仍走直连例外。现在无论有没有住宅跳，TCP 助手域名和该网段都先路由到住宅跳或 `Tono-Exit`；对应 UDP 在直连例外之前拒绝，QUIC 失败后回到已路由的 TCP。普通中国站点的直连不变。
- 新增/优化：无。
- 工程与测试：`SingBoxConfigTests.testAssistantDestinationsPrecedeReviewedBundleDirectWithoutAHomeHop` 断言无住宅跳时四条助手规则先于 `Tono-China-App`，且 mihomo 文本里同一标记先于 WeChat 进程规则。
- 验证：Linux 云代理无 Swift 工具链，XCTest 未在本地执行，由托管 macOS CI 验证。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需 `needs-hardware`。不能声称客户设备上的 QUIC 回退已实测。不改严格断网开关，也不把非助手流量改成拒绝。
