## 2026-09-30 · macOS 默认上行变化才重建隧道
- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1。macOS 已连接会话的网络切换。
- 来源：`main` `d2363002` 上的 `cursor/macos-uplink-roam-4352`；未合 main。
- 缺陷修复：重连判定不再比较全部物理 IPv4 地址。扩展坞或第二块网卡拿到地址不再拆隧道。同一 Wi-Fi 服务上地址或网关换成另一个具体值、Wi-Fi 与以太网对换、以及 IPv6-only 的默认下一跳变化，仍会在已武装的 Kill Switch 后重建。DHCP 空窗、APIPA、动态库读失败保持上一次基线，不拆隧道。
- 新增/优化：无新旁路。双栈上单独的 IPv6 路由器抖动不重建。
- 工程与测试：`NetworkUplinkHarnessTests` 用快照覆盖上述读数；不驱动 SCDynamicStore、PF 或真网卡。
- 验证：本环境无 Xcode，`xcodebuild` 未跑。hosted macOS CI 待跑。
- 候选/发布：仅源码，无新包。
- 剩余限制：未在真机上切换 Wi-Fi、睡眠或门户。门户登录仍被失败关闭挡住，本 PR 不放开 PF。
