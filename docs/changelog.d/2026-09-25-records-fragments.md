## 2026-09-25 · 流程：内部更新记录与发现总账改为分文件，消除并行 PR 冲突
- 归属：ops 任务（工程流程）；不影响任何客户端、Worker 或节点行为。所有者 2026-09-25 批准（Jev-Decision e1e20b55）。
- 来源：基线 origin/main `33745f7d`；分支 `docs/records-fragments-20260925`；未合 main。
- 缺陷修复：无（流程问题：每合入一个 PR，其他并行 PR 都在 `INTERNAL_CHANGELOG.md` 与 `FINDINGS_LEDGER.md`
  顶部冲突，需重新合并 main 并多跑一轮 8–12 分钟 CI；当天手工拼了三列合并列车）。
- 新增/优化：新条目写 [changelog.d/](README.md)（一次交付一个文件），新发现写 [findings.d/](../findings.d/README.md)
  （一个 ID 一个文件）；两份旧文件保留为冻结历史并在顶部加指引，已有行的状态变化仍改原行。
  新增只读工具 `tooling/scripts/records.mjs`（无依赖）合并阅读：`changelog [--since]`、`findings [--status] [--id]`。
  AGENTS.md 与 docs/README.md 改指向新位置，记录义务不变。
- 工程与测试：新增 `tooling/scripts/tests/records.test.mjs`（一个用例），由 services-ci 已有的
  `node --test "tooling/scripts/tests/*.test.mjs"` 收录。
- 验证：MacBook 本地 `node --test tooling/scripts/tests/records.test.mjs` 通过；
  `node tooling/scripts/records.mjs findings --status open` 输出现有总账中的 open 行。
- 候选/发布：仅流程与工具，无新候选。
- 剩余限制：已开且在两份旧文件顶部加了条目的 PR 与本 PR 会冲突一次，需把条目挪进分片文件；
  表格解析按 `|` 分列，单元格内未转义的 `|` 会错列（现有总账没有此情况）。
