## 2026-09-30 · macOS APIPA 链路本地网关不再拆隧道
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1。macOS 已连接会话的上行判定。
- 来源：`origin/main` `ff81118a` 上的 `hunt/grok-macrt-apipa-gateway`；[#835](https://github.com/raydocs/tono/pull/835)；未合 main。
- 缺陷修复：DHCP/APIPA 空窗把 IPv4 网关报成 `169.254/16` 时，与 `0.0.0.0` 和 `169.254` 地址一样视为不完整读数，保持上一次基线，不拆隧道。换成另一个具体的非链路本地网关仍然是迁移。
- 新增/优化：无。
- 工程与测试：`NetworkUplinkHarnessTests.testLinkLocalGatewayDuringRenewalIsNotANewNetwork`。
- 验证：本环境无 Xcode，`xcodebuild` 未跑。hosted macOS CI 待跑。
- 候选/发布：仅源码，无新包。
- 剩余限制：未在真机上制造 169.254 网关。
