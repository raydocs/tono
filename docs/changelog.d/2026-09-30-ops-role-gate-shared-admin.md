## 2026-09-30 · 运维角色门覆盖 shared-admin 与 legacy 路由（H4-F3）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)（控制台合一第 1 阶段，不是发布门）；只动 `services/control-plane` Worker。
- 来源：main `d2363002` → 分支 `cursor/ops-role-gate-shared-admin-d728`；未合 main。
- 缺陷修复：H4-F3。配置了 `OPS_ROLES` 且有非 owner 角色时，Access 门上的 shared-admin 资源（目录/分流发布、家宽库存、出口节点、设备动作、商家账号、`POST signup-allowlist`、原始诊断日志读取）和 legacy 读都不查角色。改后 `src/index.ts` 的 Access 分支先过 `src/ops/access-roles.ts`：shared-admin 与 legacy 各一张 (方法, 路径) → 动作表，原始日志一律要 `customers.raw-logs`，三张表（含 v1）都不认识的路径仅 owner。bearer 门不变。
- 新增/优化：无。角色取舍见 [DECISIONS](../DECISIONS.md) 2026-09-30 条（provisional）。
- 工程与测试：`test/ops-roles.test.ts` 加两条：shared-admin 写与原始日志被拦、legacy 读被拦且未知路径仅 owner。撤掉 `index.ts` 那一处调用后两条都失败。`src/index.ts` 净减 1 行。
- 验证：`services/control-plane` `npm run typecheck`、`check:contract`、`check:budgets` 通过；`npx vitest run` 43 个文件 936 条通过。
- 候选/发布：仅源码，无新候选；未部署。生产未设 `OPS_ROLES`，所有 Access 邮箱仍解析为 owner，部署后行为不变。
- 剩余限制：`ops_audit.actor_role` 仍记 `owner`；控制台 `VITE_OPS_ROLE` 只影响导航，不读服务端角色。
