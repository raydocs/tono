## 2026-09-30 · 旧后台目录页只读，目录与分流规则只剩一个发布点
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)（控制台合一第 1 阶段，不是发布门）；只动 `services/control-plane/admin`（旧 `/ops/`）。
- 来源：main `d2363002` → 分支 `cursor/ops1-catalog-read-only-d728`；未合 main。
- 缺陷修复：旧 `/ops/#/control` 与新 `/ops2/#/settings/{catalog,policy}` 都能 PUT `exit-catalog` / `traffic-policy`，两个编辑器各自冻结基线，谁后发谁覆盖对方审过的版本。改后旧页只读：发布概况、线上修订号和历史摘要保留，编辑按钮换成链到新后台对应设置节；`operationsApi.replaceCatalog` / `replaceTrafficPolicy` 与只服务旧编辑器的 `lib/draft-guard.ts` 删除。Worker 接口不变。
- 新增/优化：无。新后台已有 YAML 对照发布、409、历史摘要、分流 `dryRun` 预演与「关闭网页直连 / 关掉全部直连」快捷，[parity-audit](../ops/parity-audit.md) 对应五行改为「覆盖」。
- 工程与测试：`ControlPage.test.tsx` 原来测未发布草稿的离开提醒，编辑器没了就换成一条：页面没有编辑框，两个按钮指向新后台。
- 验证：`services/control-plane` `npx tsc -p admin/tsconfig.json --noEmit` 通过；`npx vitest run -c vitest.admin.config.ts` 2 个文件 4 条通过。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：旧页 CSS 里编辑器相关样式未清，随旧后台整体退役一起删。
