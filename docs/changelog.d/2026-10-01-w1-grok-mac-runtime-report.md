## 2026-10-01 · W1 macOS 运行时清点（Grok）

- 归属：[SHIP_PLAN](../SHIP_PLAN.md) G1。只记录，不改产品行为。
- 来源：对照 `origin/main` `5ba113d2`。分支 `hunt/grok-macrt-w1-report`；PR 待开；未合 main。
- 缺陷修复：无（修复在 #835、#836、#840、#854）。本条只记录清点。
- 新增/优化：`docs/agent-reports/W1-grok-mac-runtime.md`。未修的三条记为 #861、#863、#864。
- 工程与测试：无产品代码。
- 验证：只读 `gh` 与源码。XCTest 未在本机跑。
- 候选/发布：无新包，仅文档。
- 剩余限制：四个修复 PR 的 XCTest 由 macOS CI 执行。本条不声称那些测试已在本机通过。标签接口 403，#840 的 `needs-hardware` 没加上。
