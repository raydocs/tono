## 2026-09-30 · TUN 不再收下有限广播和 IPv6 组播
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1。macOS TUN 下隔空播放、随航、通用剪贴板。
- 来源：`main` `d2363002` 上的分支 `cursor/macos-continuity-onlink-3d9f`，[#700](https://github.com/raydocs/tono/pull/700)。未合 main。
- 缺陷修复：产品 sing-box 的 `route_exclude_address` 补上 `255.255.255.255/32` 和 `ff00::/8`，与已有的私网、链路本地和 `224.0.0.0/4` 放在同一份静态表 `tunRouteExcludeCIDRs`。Darwin auto-route 因此不再把有限广播装进 utun。不新增 PF 规则，不升级 helper，不恢复进程级公网 DIRECT。
- 新增/优化：无。
- 工程与测试：`testContinuityLocalBypassDoesNotForcePublicAppleTrafficDirectWithoutPolicy` 增加排除表断言，并拒绝出现 `/0`。
- 验证：Linux VM 不能跑 XCTest、`pfctl` 或 utun。hosted macOS CI 待跑。没有在 Mac 上连接、改路由或改 PF。
- 候选/发布：仅源码，无新包。
- 剩余限制：在网全球 IPv6 和非私网 IPv4 仍由现有 Kill Switch 丢弃（MAC-CONTINUITY-ONLINK-PF，未改）。IPv6 组播排除在当前「TUN 无 IPv6 地址」下不安装内核路由。未证明通用剪贴板或隔空播放已恢复。连接失败时仍用应用里的 Restore internet，本改动不改变那条恢复路径。
