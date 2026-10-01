## 2026-10-01 · Grok W6/W8 审查记录

- 归属：G1 保护不得放宽；文档。审查范围是 Windows IPC 与运行时完整性（W6、W8）。
- 来源：基线 `origin/main` `71bd69d8`；分支 `cursor/grok-w6w8-report-f6c6`；提交时未合 main。
- 缺陷修复：无（修复在 [#917](https://github.com/raydocs/tono/pull/917)，发现 W8-G-F1）。
- 新增/优化：无。
- 工程与测试：新增 `docs/agent-reports/grok-W6W8.md`。
- 验证：只读审查加上述报告。产品测试不在本 PR。
- 候选/发布：仅文档，无新候选、无新包。
- 剩余限制：#917 未合入前，报告里的修复还不是 main 上的行为。needs-hardware 由该修复 PR 承担。
