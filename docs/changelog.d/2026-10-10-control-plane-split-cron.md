## 2026-10-10 · 控制面五分钟 cron 拆出 index.ts（A28）
- 归属：ops 任务，[运维计划](../ops/plan-2026-09-11.md)；Amp 待办 [A28](../ops/amp-backlog-2026-10-10.md)（D6-A）；影响 `services/control-plane`。
- 来源：基线 `origin/main` 4e373f06 → 分支 `amp/a28-split-cron`；PR 见分支；未合 main。
- 缺陷修复：无。
- 新增/优化：无行为变化。`enforceAll`、`ENFORCE_USERS_PER_TICK`、只有 cron 用的 `cleanupOrphanPendingNodes`
  与 `enqueueRevocation` 原样移到 `src/scheduled.ts`；`ROUTING_RESEARCH_RETENTION_MAX_SECONDS`（值不变，90 天）随之移出并由
  index.ts 引回。和请求路径共用的 `enforceUser`、`expirePending`、`processRevocations`、`tailscale` 留在 index.ts，
  经 `ScheduledDeps` 传入（同 `SharedAdminDeps` 的做法），scheduled.ts 不反向 import index.ts。ops cron 本来就在
  `src/ops/cron.ts`，未动。`scheduled` 入口仍在 index.ts 默认导出，wrangler 的 `main` 与 cron 触发器未变。
- 工程与测试：`test/index-size.txt` 由 3629 降到 3483（index.ts 新行数），棘轮不能再回涨；`docs/architecture.md` 的已拆出清单加 `scheduled`。
- 验证：Linux orb，Node 24。拆前拆后各跑一次 `npm test`：均为 45 个文件 / 1008 条通过（含 `worker.test.ts` 里直接调
  `worker.scheduled` 的十余条）；`npm run typecheck` 通过（noUncheckedIndexedAccess 错误集合与 main 逐条相同，520 条）；
  `check-ops-budgets.mjs`、`check:contract` 通过；`wrangler deploy --dry-run` 打包成功（未部署）。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：纯移动，未拆 index.ts 其余部分（A23）。
