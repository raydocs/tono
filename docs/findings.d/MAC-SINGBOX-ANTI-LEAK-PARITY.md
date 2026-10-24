| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-SINGBOX-ANTI-LEAK-PARITY | macOS sing-box 缺少靠前的共享 STUN/海外 UDP、853 拒绝和 HTTPS/SVCB 抑制，DIRECT 可先匹配 | in-PR | fix/r2-mac-antileak | 高·推导 | TonoTests/打包核心解析待 CI，WebRTC/DoT/IPv6 待真机；PF 不变 |

基线 eaab10d49：`ConfigPipeline+SingBoxProduct.swift:224,236,319-354`，
`ThreeTierRoutingContract.swift` 的两份生成模板。对照和验证：
[macOS 防泄漏移植](../reports/2026-10-24-macos-anti-leak-parity.md)。
