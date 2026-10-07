## 2026-10-07 · 控制面：Tailscale 注册暂停时，已排队的 tailnet 吊销照常执行
- 归属：SHIP_PLAN §2 item 10（0.0.75 修复批，owner 2026-10-07）；控制面 Worker 客户生命周期。内部审查 H17-G-F2（= H17-O-F5）、H17-C-F2。
- 来源：main `f2cb79522` → 本 PR（分支 `claude/cp-closure-atomic-tailscale-revoke-20261007`）；未合 main。
- 缺陷修复：H17-G-F2 —— 生产 `TAILSCALE_ENROLLMENT_ENABLED=false` 时 `processRevocations` 直接返回，cron、`enforceUser`、设备删除与上报路径都不删吊销设备的 tailnet 节点，排队任务永不完成（#523 已让重新启用不再永久 409，但节点仍留在 tailnet）。改后：删除节点属于吊销，注册暂停时也照常执行；暂停只围住新注册（`issueEnrollment`、enrollment/confirm 路由仍 410）。ops 恢复时的审计行改为「下一个 cron 周期执行」。H17-C-F2 —— 核对 main：#525（`61abd20b`）已把销户做成单个 `DB.batch`、停用在前，且有故障注入回归；本 PR 不改代码，只把台账行改为 fixed。
- 新增/优化：无。孤儿 pending 节点清扫（要拉 tailnet 设备清单）仍只在注册开启时跑。
- 工程与测试：`test/worker.test.ts` 新增 `deletes a queued tailnet node on the cron tick while enrollment is paused`；旧代码实跑失败（`expected false to be true`）。`src/index.ts` 3783 → 3780 行，`test/index-size.txt` 同步。
- 验证（MacBook，Node）：`npx vitest run test/worker.test.ts test/ops-api.test.ts test/index-size.test.ts` 3 文件 262 用例通过；`npm run typecheck` 通过。生产 D1 只读查询：0 台设备带 `tailscale_node_id`，1 条未完成吊销任务（原因 `account_device_reset_vless_only`，设备行已不存在，`last_attempt_at = 0`）——部署后第一个 cron 周期会删除该节点。完整套件以 PR 的 ci-gate 为准。
- 候选/发布：无新包，仅源码；未部署。
- 剩余限制：部署后需确认那 1 条任务完成（`completed_at` 非空）或 `last_error` 说明原因（例如生产 OAuth 凭据失效）；凭据失效时任务持续失败但不挡重新启用。注册暂停时不扫孤儿 pending 节点。token-admin 恢复路径仍不写审计。
