## 2026-09-30 · Windows 前端 lint 归零与 refresh 失败清理改渲染时调整

- 归属：工程与测试修正（`pnpm lint` 在 main 上 4 warnings 失败；非 CI 门，不属 SHIP_PLAN 发布门）。
- 来源：基线 `d1f89c1c` → 本分支；分支 `cursor/fix-win-app-lint-8a8e`；PR 待建（目标 main）。
- 缺陷修复：无产品行为变更。
- 新增/优化：无。
- 工程与测试：`eslint --fix` 修 3 处 import 排序（`update-viewer.tsx`、`update-viewer.test.tsx`、`activity.tsx`）；`servers.tsx` 把 `useEffect(() => setRefreshError(null), [catalog?.lastSyncedAtMs])` 改为渲染时调整（记录已清理的 sync 时刻，变化时同 render 清掉），消掉 `@eslint-react/set-state-in-effect`，语义与原来一致（成功 sync 移动即清，失败 sync 不移动不清）。新增一个窄回归 `clears the page refresh failure once a later sync moves`（失败出现 → 后续成功 sync → 失败消失），锁住 #590 行为。
- 验证：Linux 本机 `pnpm typecheck` 通过；`pnpm lint` 通过（0 warnings）；`vitest run src/pages/tono/servers.test.tsx` 16/16（含新测试）；全套 `pnpm test` 38 文件 294/294。Windows 原生侧未动，无需真机。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`pnpm lint` 仍不是 CI 门；本 PR 只让仓库自带命令变绿。
