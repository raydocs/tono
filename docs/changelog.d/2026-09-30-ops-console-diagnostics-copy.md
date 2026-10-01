## 2026-09-30 · 运维台诊断面板的中文文案搬进 src/copy
- 归属：工程（质量门）；`services/ops-console/src/pages/diagnostics/*`、`src/copy/diagnostics.ts`、`src/pages/Today.tsx`。
- 来源：`origin/main` → 分支 `fix/ops-console-diagnostics-copy`。
- 缺陷修复：#734 把失败聚类和自动诊断的中文直接写在 tsx 里，`npm run lint`（`ops/no-implementation-note-copy`，16 处）和 `copy.test.ts` 的「tsx 不含中文」在 main 上失败。CI 的 ops-contract 只跑 typecheck 和 build，没有拦住。
- 新增/优化：无，界面文字逐字不变。
- 工程与测试：文案集中到 `copy.diagnosticsPanel`；Today 的一句注释改成英文。
- 验证：ops-console `npm run typecheck`、`npm run lint`、`npx vitest run`（34 个文件全过）、`npm run build`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：ops-console 的 lint 和单元测试仍不在 CI 里。
