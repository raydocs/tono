## 2026-09-26 · 控制面：ops PATCH signup-allowlist/{id} 补角色门
- 归属：ops 计划（[docs/ops/plan-2026-09-11.md](../ops/plan-2026-09-11.md)），非发布门；`services/control-plane` ops 路由 `src/ops/router.ts`。
- 来源：基线 origin/main `3470dd68`；红分支 `wip/cp-allowlist-patch-authz-20260926-red`（`0672b51b`），修复分支
  `fix/cp-allowlist-patch-authz-20260926`；未合 main。
- 缺陷修复：发现 H4-F3 的 signup-allowlist 写一项。同一路径的 DELETE 要求 `customers.write`，PATCH `signup-allowlist/{id}`
  却不查角色，配置了 OPS_ROLES 的 viewer 也能改白名单条目。改后 PATCH 与 DELETE 一样先 `requireCan('customers.write', role)`，
  无权返回 403 `ROLE_FORBIDDEN`。未配置 OPS_ROLES 时所有人仍按 owner 处理，行为不变。
- 新增/优化：无。
- 工程与测试：`test/ops-roles.test.ts` 新增一个 `it`（viewer PATCH signup-allowlist/{id} 得 403）。红分支按断言失败（得 400，处理函数被执行）。
- 验证：本机 `npx vitest run test/ops-roles.test.ts` 4/4 通过；全量 `npm test` 见 PR。
- 候选/发布：仅源码，无新候选；需部署控制面后生效。
- 剩余限制：同一发现的另两项未在此修：shared-admin 路由不经 ops 角色门（已记录限制），原始诊断日志读取
  （`src/ops/shared-admin/diagnostics-logs.ts`）不查 `customers.raw-logs`。本路由内其余写路由都已有角色门。
