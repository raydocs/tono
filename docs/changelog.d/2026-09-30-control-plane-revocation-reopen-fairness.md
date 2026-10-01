## 2026-09-30 · 控制面：重开的撤除任务不再继承旧 last_attempt_at
- 归属：缺陷修复（发现 CP-REVOCATION-REOPEN-ATTEMPT），非发布门条目；`services/control-plane/src/index.ts`
  撤除 outbox（`processRevocations` 与六处 `ON CONFLICT(tailscale_node_id)` 重开路径）。
- 来源：main `01c2403f` → 分支 `glm/cp-revocation-reopen`；PR [#758](https://github.com/raydocs/tono/pull/758)；未合 main。
- 缺陷修复：0038 迁移给新撤除任务 `last_attempt_at` 默认 0，`processRevocations` 每次尝试前打戳，把失败任务轮换到
  少试的一方之后；但六条重开路径（`enqueueRevocation`、`expirePending`、设备轮换 `device_rotated`、`revokeDevice`、
  confirm 守卫、身份重登记）的 `ON CONFLICT(tailscale_node_id) DO UPDATE` 只清 `completed_at`/`last_error`，不清
  `last_attempt_at`。同一节点再次撤除时任务继承上一次的旧戳（不早于失败批次上一拍，且 `created_at` 被重置为最新），
  在 `ORDER BY last_attempt_at, created_at, id LIMIT 40` 里排到最多 40 个持续失败任务之后，本轮不被尝试；期间该设备
  重登记被 409 `REVOCATION_PENDING` 挡住。改后六处 SET 列表均加 `last_attempt_at = 0`，重开任务与新任务一样排最前。
- 新增/优化：无。
- 工程与测试：`test/worker.test.ts` 新增一个 `it`：先落一条带旧戳的已完成任务和 40 条同拍失败任务，经登录路径
  （`expirePending`，无内联处理）重开后断言 `last_attempt_at` 归零，且一次 scheduled 拍里先于失败任务被尝试并完成。
- 验证：本机（Linux worktree）`npx vitest run test/worker.test.ts` 197/197 通过；临时去掉六处修复后该测试按预期失败
  （`last_attempt_at` 仍为旧戳）再复测通过。Xcode / Windows / cargo 本次未触及未运行；hosted CI 待跑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：需部署控制面后生效；未在真实 Tailscale 上验证重开场景（测试走 mock inventory）。轮换只保证公平排序，
  上游持续失败时任务仍按拍重试，不新增告警。
