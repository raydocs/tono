| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-SINGBOX-ANTI-LEAK-PARITY | 为 macOS sing-box 防泄漏规则顺序（853、STUN、海外 UDP、HTTPS/SVCB）与 Continuity 本地 IPv6 / AI Home 普通 UDP 边界补齐 ci-gate 与 XCTest 逐条门禁 | in-PR | #1747 | 高·路由 | WebRTC/DoT/IPv6 真机实测仍待 macOS 26 Apple Silicon 验收；PF 不变 |

基于 `main`（含 `#1820` 桌面防泄漏同源生成与 `#1822` Three-tier 共享 LAN 放行）：`ConfigPipeline+SingBoxProduct.swift`、`ThreeTierRoutingContract.swift` 与 [macOS 防泄漏门禁对照](../reports/2026-10-24-macos-anti-leak-parity.md)。
