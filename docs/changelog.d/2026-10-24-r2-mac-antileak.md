## 2026-11-06 · macOS sing-box 防泄漏规则顺序门禁与 AI Home / Continuity 边界对齐
- 归属：SHIP_PLAN §2 item 10；macOS 配置测试与 `ci-gate` 路由契约门禁；分支 `fix/r2-mac-antileak`（#1747）。
- 来源：基于合入 `#1820`（`799a243`）与 `#1822`（`8a549a4`）后的最新 `main` 重整。
- 缺陷修复：消除旧版防泄漏断言误把 AI Home 普通 UDP 标为拒绝（违反 Decision 130）以及未区分海外公网 IPv6 UDP CIDR 与末尾全局 IPv6 拒绝（Continuity 本地 IPv6 绕行）及 `#1822` Three-tier 逻辑 LAN 路由顺序的问题。
- 新增/优化：在 `ci-gate.yml` 接入 `tooling/scripts/tests/macos-anti-leak.test.mjs` 并在 `SingBoxConfigTests` 增加 6 项逐规则顺序断言（853、STUN 端口、公共 STUN 后缀、海外 IPv4/IPv6 UDP、客户端入站 `HTTPS`/`SVCB` 抑制）。
- 工程与测试：保持 `ThreeTierRoutingContract.swift`、`ConfigPipeline+SingBoxProduct.swift` 与 `HelperProtocolVersion`（`4.52.70`）不变，不改变 PF 或连接语义。
- 验证：本地通过 `macos-anti-leak.test.mjs`、`routing-domains-sync.test.mjs`、`desktop-lan.test.mjs`、macOS/iOS/Android 路由漂移检查及 `tono-core` 测试；`SingBoxConfigTests` 交由 `macos-26` CI 验证。
- 候选/发布：仅测试门禁与文档，无新候选、部署或客户发布。
- 剩余限制：WebRTC/STUN、DoT/DoQ 回退与双栈 IPv6 真机实测仍待 macOS 26 Apple Silicon 验收。
