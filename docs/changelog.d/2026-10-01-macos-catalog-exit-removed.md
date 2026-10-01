## 2026-10-01 · 目录删掉当前出口不再整机阻断

- 归属：SHIP_PLAN §2 第 10 项（装上会坏）；macOS 已连接会话的目录更新。
- 来源：main `27e65ba6` → 分支 `cursor/r3-catalog-exit-removed-89a9`；PR #963；未合 main。
- 缺陷修复：选中的云出口从新目录消失时，原来先 `disconnect(releaseKillSwitch: false)`，PF 收到 bootstrap。现在还有别的目录出口就改选并保持这次连接；一个都没有就把原来的网络放回来，并写明要另选出口。显式严格模式（`permanent`）仍可保持阻断。关联 MAC-CATALOG-NODE-REMOVED-BLOCK。
- 新增/优化：无。空闲未连接的提示不变。热切换若武装失败，非严格改为放行，不再安排保护重连。
- 工程与测试：`CatalogRemovedExitTests.testRemovedExitKeepsASurvivorOrRestoresTheOriginalNetwork`。断开用的特权调用换成空操作。续：五句新提示补了 zh-Hans；`test-multi-exit-policy.sh` 编进 `ProtectedConnectivity.swift`（`ExhaustedFailureNetwork`）以及它点名的 `CertificateClock`、DNS 探测和系统解析器，否则策略测试在 `ProxyNode.swift` 找不到该类型。
- 验证：Linux 工作树逐行对照。无 Swift/Xcode，未编译、未运行 XCTest；hosted macOS CI 待运行。目录 JSON 用 Python 读过。
- 候选/发布：仅源码，无新候选。
- 剩余限制：网络行为变更，needs-hardware。选择性 AI 底没有装进这次改动；钩子未注册时，没有幸存者就是整网放行。不声称真实 IP 到不了 AI 服务。策略更新的整机阻断是另一 PR。
