## 2026-10-10 · 调低设备上限当场按 LRU 撤销超额设备（H17-C-F1，D15-A）
- 归属：ops 任务（[运维计划](../ops/plan-2026-09-11.md)，[Amp backlog](../ops/amp-backlog-2026-10-10.md) A9，§7 D15 = A）；控制面账户设备逻辑。
- 来源：origin/main `3e6aebd2` → 分支 `amp/a9-device-cap-immediate`，[#1487](https://github.com/raydocs/tono/pull/1487)；未合 main。
- 缺陷修复：token-admin `PATCH /api/v1/admin/users/:id` 调低 `deviceLimit` 后，超出上限的设备一直可用，要等这个账户下一台新设备登录才按 LRU 轮换（H17-C-F1）→
  PATCH 把写上限的 `UPDATE users` 和驱逐放进同一个 D1 batch（一个 SQLite 事务）：先写新上限，再按刚写入的上限选出并撤销该账户最近最少出现的超额在用设备（`pending`/`active`）；驱逐失败则上限和设备都不变、请求返回 5xx：
  排序与登录轮换共用 `DEVICE_LRU_ORDER`（`last_seen_at` 与最新遥测心跳取较晚者，平局按 `created_at`、rowid）；
  走和登录轮换相同的撤销出口：`revocation_jobs`（原因 `device_limit_lowered`）、设备行改 `revoked`、会话吊销、删除出口凭据；
  每台写一条 `device.revoke` 审计（actor `token-admin`），有撤销时随即跑一次 `processRevocations`（失败留给 cron 重试）。
  超额数在事务里按本次写入的 `device_limit` 与当时已提交的在用设备数计算，所有语句都限定该 `user_id`：重试、并发或中途被调高都不会多踢；调高上限不动设备。
- 新增/优化：无迁移；Access 运维控制台的用户 PATCH 不能改设备上限，未改。登录轮换的 LRU 排序搬到 `src/accounts.ts` 共用，行为不变。
- 工程与测试：`test/worker-devices.test.ts` 新增 `revokes the least recently seen excess devices of that account only when the device limit is lowered`；
  原 `atomically evicts every excess device after a device-limit contraction` 改为直接写库调低上限，继续覆盖「已超额账户下次登录收敛」。
  评审续修（Grok 评审 #1487 @f9d818c2，MINOR）：上限写入与驱逐原为两个事务，现合并为一个；新用例末尾加一段：驱逐语句失败时 PATCH 返回 500、上限仍为 5、设备不变（旧代码上该段失败：上限已变 1）。
- 验证：本机 Linux、Node 24：`npx vitest run test/worker-devices.test.ts` 30 passed；改动前新用例失败（5 台仍在用，期望 3 台）；
  `npx vitest run` 全量 61 files / 1010 tests passed；`npm run typecheck` 通过（unchecked index 520 ≤ 基线 521）。CI 见 PR。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：审计和 `processRevocations` 在事务提交后执行，与运维单台撤销相同（审计失败不回滚撤销）。
- 续记 2026-10-10：评审续修后本机 `npx vitest run` 61 files / 1010 tests passed，`npm run typecheck` 通过。
