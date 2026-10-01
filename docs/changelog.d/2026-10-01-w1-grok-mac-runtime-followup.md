## 2026-10-01 · W1 macOS 运行时清点续记（Grok）

- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1。只记录，不改产品行为。
- 来源：对照 `origin/main` `f80951fb`。分支 `hunt/grok-macrt-w1-followup`，叠在 #876 上；PR #888；未合 main。不启用自动合并。
- 缺陷修复：无（修复在 #882、#885）。#861 仍开着。
- 新增/优化：`docs/agent-reports/W1-grok-mac-runtime.md` 续记。补读备份通道、持久化写入、在线目录拆除和 `HelperProtocolVersion` 后没有新的已核实缺陷。
- 工程与测试：无产品代码。
- 验证：只读源码。XCTest 未在本机跑。
- 候选/发布：无新包，仅文档。
- 剩余限制：#882 与 #885 的 XCTest 由 macOS CI 执行。本条不声称那些测试已在本机通过。
