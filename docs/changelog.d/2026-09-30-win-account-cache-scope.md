## 2026-09-30 · Windows account card isolates cached metadata by sign-in generation
- 归属：SHIP_PLAN §2 item 10; Windows account/session correctness.
- 来源：origin/main `4453e258` → branch `hunt/sol-winapp-account-cache-scope`; source PR, not merged at authoring.
- 缺陷修复：WIN-ACCOUNT-CACHE-OWNERSHIP (P1): supported replacement login could show the prior account's private device names next to the new email after a failed device read; queries now use the opaque auth scope.
- 新增/优化：无; layout, backend identity fencing, routing and AI/strict protection behavior are unchanged.
- 工程与测试：one real React/SWR account-card regression covers replacement login with a pending then failed new device request; explicit card sign-out clears the scoped keys.
- 验证：Linux, existing Node 22.14.0, pinned pnpm 11.26.0/frozen lockfile, Vitest 5.0.1. Regression failed before the fix (previous private laptop visible); after fix, account-scope and confirmation-dialog checks passed (4 tests), TypeScript typecheck, touched-file ESLint and `git diff --check` passed.
- 候选/发布：仅源码，无新候选，无部署/发布。
- 剩余限制：native Windows sign-in flow not executed on this Linux host; cold offline admission without a recovered account disables account/device reads until ownership becomes available.
