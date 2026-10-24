# T6 控制面修复验证（2026-10-24）

- 工作树：`/Users/ruirui/tono-wt/t6-control-plane`；分支 `fix/t6-control-plane`。
- 开工 `git fetch origin` 成功；基线与当时最新 `origin/main` 均为 `322f48c6fcb13b26279fed22ae19f79dcc2522bb`，三个 P1 未被修复。
- 验收：有效会话的到期/额度状态不是 401；中继登录按 subject 限流而非共享源地址；FAILURE 桶耗尽不妨碍 P0 写入；429 提供真实剩余窗口。显式撤权、网络授权和账户隔离不放宽。
- 主机：本地 Mac；Node `v26.12.1`、npm `11.20.0`。`npm ci --no-audit --no-fund` 成功（实际输出 `added 210 packages in 7s`；本地版本不作 CI 环境等价证明）。无生产 D1/服务器操作。

## 可复现命令

在 `services/control-plane`：

```sh
npx vitest run test/worker-account-state.test.ts
npx vitest run test/worker-login-relay.test.ts
npx vitest run test/worker-p0-budget.test.ts test/ingest-limits.test.ts
npx vitest run test/worker-account-state.test.ts test/worker-login-relay.test.ts test/worker-p0-budget.test.ts test/ingest-limits.test.ts
npm run typecheck
npm test
```

## RED / GREEN：真实终端断言

1. 账户状态：RED 测试提交 `336a2fa59`（生产树仍等于基线），命令第一行。
   - `Tests 2 failed | 1 passed (3)`；到期与超额均 `AssertionError: expected 401 to be 403`。
   - GREEN `d2d512985`：`Tests 3 passed (3)`；同时断言 enforcement 不撤销账户 session、网络 credential 删除、续费旧身份不自动复活、显式设备撤权仍 401。
2. 中继登录：RED `fc2fbc0fb`，生产树包含账户修复但 login 限流仍是基线。
   - `Tests 3 failed | 1 passed (4)`；第二个邮箱/challenge/installation 被共享 IP 桶拒绝：`Too many attempts; try again later`、`status: 429`。
   - GREEN `cd7b590f3`：`Tests 4 passed (4)`；全局邮箱/challenge/installation cap 与伪造 forwarded header 的直连 cap 均未失效。
3. P0 独立桶：RED `9c2939511`。
   - `Tests 2 failed (2)`；FAILURE 桶填满后 P0 `expected 429 to be 202`；旧 P0 也在第 13 次被普通 FAILURE cap 拒绝。
   - GREEN `f63937e7d`：P0 + Env key contract `Tests 3 passed (3)`。
4. Retry-After 补充回归：测试在 `2e09b91c4`。对同一测试临时仅把 **本线程拥有的** `src/request.ts` 和 `src/ops/ingest-limits.ts` 换回 `git show 322f48c6f:<path>`，退出 trap 恢复新实现。
   - RED 命令 `npx vitest run test/worker-p0-budget.test.ts -t 'actual remaining login window'`：`Tests 1 failed | 2 skipped (3)`，`expected null to be '777'`。测试先确认 HTTP 429，失败点是真实缺 header，而非编译或 skip。
   - GREEN 新实现：冻结 Date.now，在 900 秒窗口已用 123 秒时返回精确 `Retry-After: 777`；无 sleep。

补充无回归声明：`ef49c5560` 为新分类 helper 加 root 防御检查及 null-body 契约测试；该 null 测试在加检查前已通过（上游 body() 本来就拒绝 null），不是新的产品缺陷、不是 RED，不计为已修复 bug。

## 最终验证

实现/测试提交：`ef49c5560`（含 `2e09b91c4` 的续费/Retry-After 补充测试）；随后只补交付文档。

- 窄回归四文件实际输出：`Test Files 4 passed (4)`；`Tests 12 passed (12)`。
- typecheck：`unchecked indexed access errors 520 (baseline 521)`；admin `76 (baseline 99)`。
- additive migration 静态检查：`pending migrations: 0104_device_entitlement_suspension.sql`；`pending migrations are additive (no DROP, no RENAME, no NOT NULL column without DEFAULT)`。本地 Vitest D1 已实际应用全量 migration；未在 preview/生产演练。
- 扩大回归八文件：`Test Files 1 failed | 7 passed (8)`；`Tests 2 failed | 61 passed (63)`。
- 完整 `npm test`：初次运行 `f63937e7d` 后的工作树为 `Test Files 1 failed | 68 passed (69)`、`Tests 2 failed | 1063 passed (1065)`；最终实现 `ef49c55605373df89107a3ae5c7eb4925bc796ba` 重跑为 `Test Files 1 failed | 68 passed (69)`、`Tests 2 failed | 1065 passed (1067)`；只有下列两条未改动的旧401期望失败。
- `git diff --check`：通过。

### 未改动的既有测试冲突（不是全绿）

`test/worker-roster-quota.test.ts:182`：quota 后 `/me` 明确期望 401，实际 403。
`test/worker-roster-quota.test.ts:231`：续费后原 refresh 明确期望 401，实际 403 `DEVICE_REAUTH_REQUIRED`。
这两条旧规范与本任务“账户状态不得映射为401/登出”直接冲突；遵守“不改测试期望”，原测试保持不变，不跳过，不伪装客户端版本。PR 不具备可合并的全绿证据，需编排者协调规范/旧测试。

## 跨线程和未验证项

- 首提交 `3205b5c76` 先提供 [错误码契约](../control-plane-error-contract.md)。T4/T5 已通过 T3 thread_send 通知（steered 回执），T1/T8 也已收到契约和代转请求；T2/T3 专用线程在当前可见项目/有界搜索中未找到，契约供编排者转交，不声称已送达。
- macOS 客户端 429 outbox 留 T4，Windows 留 T5，本 PR 不改其文件。已提醒 T4 当前 `entitlementCodes` 尚不含新码名。
- 新 migration 0104 只添加列；不执行生产迁移，不部署。生产迁移/回滚、真实中继、邮件提供方、移动端 VPN 配置保留、macOS/Windows outbox 重试、原生/真机/安装机均未验证。
- 未请求/未完成本 PR 的独立高风险审查；交编排者做 Claude 交叉审查，禁止据此合并或部署。
- P2 OTP 上限：基线 `index.ts:260-267` 已 `attempts < max_attempts`、D1 原子递增，challenge 插入 `max_attempts=5`；“无限尝试”不成立，不改。
- 其余可选 P2（OIDC 提供方失败耗次、邮件中文、OPS 三项）未做：优先完成三个 P1，不扩大跨服务范围。
- 未触及 feed、签名、部署脚本、客户更新源、owner G1/G2/G3；无新包，仅源码。
