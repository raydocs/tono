## 2026-10-10 · A18 hy2 自动切换审计「was」改为在写入批处理内读取（A18-AUDIT-STALE-WAS）
- 归属：ops 计划（[amp-backlog-2026-10-10](../ops/amp-backlog-2026-10-10.md) A18 遗留）；控制面 `services/control-plane`。
- 来源：基线 origin/main a6ebf460；分支 `amp/a18-audit-stale-was`；未合 main。
- 缺陷修复：按账户 PUT `users/<id>/hy2-auto-switch` 的审计文案「auto-switch was …」原先用批处理之外读的
  `before.effective`，并发写入时可能写出过时前值。改为审计 `INSERT … SELECT` 排在同一 D1 批处理的 UPDATE 之前、
  用与 UPDATE 相同的「会改变」条件，在同一事务里从更新前的行（连同全局开关）按 `resolveHy2AutoSwitch` 的顺序
  在 SQL 里算出前值（SQLite 的 `RETURNING` 只给新值，不用它）。保留：只在真正改变时写审计、同批、角色门不变。
- 新增/优化：`product-account.ts` 新增 `opsAuditStatementFrom`（摘要由同一语句内的 SQL 表达式求值）；`opsAuditStatement` 不变。
- 工程与测试：`test/worker-hy2-auto-switch.test.ts` 现有 `it` 加一条断言：全局开、账户 override off 时，
  标记 internal 的审计文案为 `set internal yes; auto-switch was off`（覆盖 override off 优先的 SQL 分支）。
- 验证：Linux orb，Node 24：`npx vitest run test/worker-hy2-auto-switch.test.ts` 1 passed；
  `npx vitest run` 64 文件 / 1019 用例通过；`npm run typecheck` 通过。并发交错本身无法在 vitest 里构造，未直接复现。
- 候选/发布：仅源码，无新候选；控制面未部署。
- 剩余限制：SQL 里的前值判定与 `resolveHy2AutoSwitch` 是两份同序逻辑，靠注释与该断言约束。
