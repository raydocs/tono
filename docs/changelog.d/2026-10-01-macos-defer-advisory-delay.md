## 2026-10-01 · macOS (sing-box) 成功之后再等 1.5 秒才做 /delay

- 归属：SHIP_PLAN G1（已连接=能用）；影响 macOS sing-box 连接成功后的建议性时延采样。
- 来源：main `6758431f`；分支 `cursor/mac-defer-advisory-delay-10e8`；未合 main。
- 缺陷修复：无。
- 新增/优化：数据面胜出后，建议性 `/delay` 等待 1500 ms。代际变了就不再探测。失败诊断仍立刻等待探测。健康检查仍立刻发起，并在 TUN 胜出时取消。
- 工程与测试：`testAdvisoryDelayDeferralLeavesTheDataPlaneVerdictImmediate` 核对常量是 1500 ms。
- 验证：Linux 回环，官方 sing-box `v1.15.0-alpha.9` 客户端，VLESS Reality，伪装接受延迟 40 ms。单独首字节稳态 42.5–43.6 ms、1 次握手（第一枪 44.8 ms、2 次）。与 `/delay` 并行时 71.1–71.5 ms、2 次握手，接口返回 503，握手已经发生。XCTest 未执行：本机没有 Xcode。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware。健康周期的探测仍可能和后来的浏览重叠。未改 sing-box JSON。
