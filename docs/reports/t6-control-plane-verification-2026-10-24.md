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

## 追加 WORKER-REFRESH-SECOND-REPLAY

- 用户追加范围；仍使用同一分支/PR #1738。再次 `git fetch origin` 成功，origin/main 仍 `322f48c6f`；在本 PR 原 head `429e23427` 确认问题存在。
- 实现/测试：`162f965495a1e241343e8313496310cf06ea37b6`，仅 `src/sessions.ts` 与新增 `test/worker-refresh-replay.test.ts`；无新 migration/客户端/部署更改。
- RED 初稿 `08c78c3fe` 中 logout 新用例误写200（既有规范是204）；这条是测试编写错误，不计产品RED。`f1da98c94` 只纠正这条**新测试**为既有204规范，既有测试均未改。
- 真实 RED：测试 `f1da98c94` + `git show 429e23427:services/control-plane/src/sessions.ts`（只暂换本线程拥有的源码，退出 trap 恢复），`npx vitest run test/worker-refresh-replay.test.ts` 输出 `Tests 3 failed | 2 passed (5)`；两条连续恢复 `expected 401 to be 200`，受控并发胜者的 root pointer 断言失败。无编译失败冒充RED。
- GREEN 新实现同命令：`Tests 5 passed (5)`。覆盖连续两次丢响应恢复；S1/S2 rotated_at=NULL且access/refresh均拒绝；仅一个live会话；第599秒仍能多次恢复、第600秒拒绝且root时间不变；正常使用交付的 successor 后旧 root 不再恢复；logout拒绝所有遗留token；受控事件暂停旧replay的batch并让另一请求先提交，旧CAS失败且不撤销胜者（无sleep）。
- `npm run typecheck`：初次 TS18047（s可能为空）已用显式空值检查修正；最终原始输出 `unchecked indexed access errors 520 (baseline 521)`、admin `76 (baseline 99)`，通过。
- 扩大四文件命令：`npx vitest run test/worker-refresh-replay.test.ts test/worker-devices.test.ts test/worker-account-state.test.ts test/worker-auth.test.ts`，`Tests 1 failed | 43 passed (44)`；唯一失败是**未改动**的 `worker-devices.test.ts:160` 明确要求第二次T0重放401，实际200，与用户追加契约直接冲突。禁止据此宣称全绿。

### 威胁模型与授权边界

1. refresh token 是持有者凭据。服务器不能区别“合法设备没收到响应”和“窃取了同一个T0的人”；本次允许该持有者在**原有**600秒内反复恢复，不增加600秒，也不增加令牌/会话TTL。窃取T0者在这段窗口内仍可能与合法客户端竞争并使旧successor失效；这是明确的有限窗口风险，不声称刷新无重放风险。
2. 只有正常轮换过的原root拥有恢复窗口。恢复时把当前successor原子换成新session，同时让root直接指向新session；root.rotated_at保持不变。被恢复替代的S1/S2记录rotated_at=NULL，不能因为自己掌握一个未交付token而再开600秒窗口。
3. 不遍历任意正常轮换链：最新successor被正常使用后会撤销，旧root不再获准追到更后的正常successor。过期/显式撤权、logout、新登录、停用账户以及本PR套餐拒绝逻辑不放宽。升级前已经断裂的root链不回填/复活。
4. D1原子batch在当前session的未撤销CAS中同时核对root仍指向它、同user/device、原窗口及root过期时间，再插入新session和重指root。失败CAS不能重指root、插入会话或撤销并发胜者。只对本次成功恢复的根做更新，不给中间token追加授权。
5. 未完成独立安全审查，需编排者在合并前安排Claude交叉审查；不合并、不部署。新令牌不入日志/文档，只存hash。

最终实现 `162f96549` 的完整 `npm test` 原始输出：`Test Files 2 failed | 68 passed (70)`；`Tests 3 failed | 1069 passed (1072)`，116.02秒。恰为之前两条套餐401契约冲突与旧one-replay契约冲突；没有隐藏或跳过。五个新增/相关窄文件重跑 `Tests 17 passed (17)`；`git diff --check` 通过。
