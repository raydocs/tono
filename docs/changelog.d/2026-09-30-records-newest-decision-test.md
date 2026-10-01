## 2026-09-30 · 决策目录测试不再写死最新一条
- 归属：工程（测试）；`tooling/scripts/tests/records.test.mjs`。
- 来源：`origin/main` → 分支 `fix/records-newest-decision`。
- 缺陷修复：`checked-in decisions are one heading per numbered file` 把 038 的标题写死为最新一条，任何新增 `docs/decisions/039-*` 的 PR 都会失败。
- 新增/优化：无。
- 工程与测试：测试改为读取编号最大的决策文件的标题，并断言 `records.mjs decisions` 的第一条就是它。文件数与标题数相等、至少 38 条的断言不变。
- 验证：`node --test tooling/scripts/tests/records.test.mjs`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无。
