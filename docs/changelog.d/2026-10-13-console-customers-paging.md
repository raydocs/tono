## 2026-10-13 · 控制台客户列表翻页到底（超过 2000 位不再丢失）
- 归属：ops 计划（ops-console）；`services/ops-console`。
- 来源：Issue #1058 的 `SOL-CP-ADMIN-USERS-PAGE`（最后一项）；分支 `claude/console-customers-paging`。
- 缺陷修复：客户列表在 2000 条处截断，且 `App.tsx` 丢弃 `nextCursor`，第 2001 位起的客户在列表、⌘K 搜索和计数里都不存在。现在客户列表沿 `nextCursor` 一直取到末页，保护上限 50,000 条；其他列表仍是 2,000 条上限。
- 新增/优化：无。
- 工程与测试：`src/lib/api-paging.test.ts`（2,450 位客户全部取回、末项正确、游标为空；普通列表仍在 2,000 处停止并保留游标）。
- 验证：见 PR 的 Verification 一节。
- 候选/发布：仅源码，无新候选；控制台前端随下次部署上线。
- 剩余限制：超过 50,000 位客户时仍会截断且界面不提示；一次加载约 ceil(N/200) 次请求。
