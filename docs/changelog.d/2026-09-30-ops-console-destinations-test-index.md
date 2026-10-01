## 2026-09-30 · 运维台目的地测试的下标访问补上检查
- 归属：工程（质量门）；`services/ops-console/src/pages/customer/Destinations.test.tsx`。
- 来源：`origin/main` → 分支 `fix/ops-console-destinations-test-index`。
- 缺陷修复：#869 新增的测试有 5 处未检查的下标访问，运维台 `noUncheckedIndexedAccess` 计数从基线 219 升到 224，`services / ops-contract` 对所有 PR 变红。
- 新增/优化：无。
- 工程与测试：正则捕获组缺失时退回空串，断言不变：缺表体或缺单元格时 `toEqual` 仍然失败。计数回到 219，基线不动。
- 验证：`npm run typecheck`（ops-console）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无。
