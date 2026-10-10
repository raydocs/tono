## 2026-10-10 · hy2 自动切换后台开关（A18）
- 归属：ops 任务 [Amp 待办](../ops/amp-backlog-2026-10-10.md) A18（D1-C）；[运维计划](../ops/plan-2026-09-11.md)。控制面 + ops 控制台。
- 来源：分支 `amp/a18-hy2-auto-switch-flag`，基线 `2e4a7dfc`；未合 main。
- 缺陷修复：无。
- 新增/优化：迁移 `0100_hy2_auto_switch.sql`：`users.internal_account`（ops 设，默认 0）、`users.hy2_auto_switch`
  （`NULL`/`on`/`off`）、单行 `hy2_auto_switch_settings.all_accounts`（默认 0）。`GET /api/v1/exit-catalog`
  在每账户视图上多一个可选字段 `hy2AutoSwitch: boolean`（本账户关 > 本账户开 > 全体开关或内部账户；hy2 块被剥掉时恒为
  `false`；读失败按 `false`）。不进 `sha256` / `routingSha256`，不改签名的分流规则，不改目录成员。shared-admin 新资源
  `GET|PUT hy2-auto-switch`（`settings.read` / `settings.publish`）与 `GET|PUT users/{id}/hy2-auto-switch`
  （`customers.read` / `customers.write`），每次实际变更写一条 `ops_audit`；账户开关变化时给该账户设备排
  `refresh_catalog`。控制台：客户页侧栏「备用通道自动切换」卡片（标内部账户、本账户开/关/跟随默认，均经确认框），
  设置 › 目录 底部全体开关（`ConfirmDialog`，确认文案带单独关/单独开的账户数）。客户端读法写在
  [transport-hy2.md](../ops/transport-hy2.md#a18-自动切换开关客户端怎么读)。暂定决定 [080](../decisions/080-2026-10-10-hy2-auto-switch-flag-shape.md)。
- 工程与测试：新增 `test/worker-hy2-auto-switch.test.ts` 一条 `it`（内部账户开、其他账户关、未声明 hy2 的客户端关、
  operator 不能翻全体开关、全体开后单独关仍关、目录内容不变、三条审计）。夹具 `fixtures/routes/hy2-switch.ts`。
- 验证：Linux orb，Node 24：控制面 `npx vitest run test/worker-hy2-auto-switch.test.ts` 1/1 通过；`npm run typecheck`、
  `check:contract`、`check:budgets` 通过；全量 `npm test` 985 过 4 超时（与控制台测试并发跑时的超时），5 个超时文件单独重跑 75/75 通过。
  控制台 `npm run typecheck`、`lint`、`npm test`（347/347）、`npm run build`（预算全绿）通过；夹具页截图见 PR。
- 候选/发布：仅源码，无新包。未部署，生产迁移未跑，preview 未演练。
- 剩余限制：客户端还不读这个字段（A17）；全体开关只在客户端下次取目录时生效，不主动推送；`effective` 是账户层结果，
  具体客户端还要收到 hy2 块才会是 `true`。
