## 2026-09-30 · 控制面关键模块覆盖率下限
- 归属：工程（质量门）；`services/control-plane` 的 auth、sessions、quota、ledger。
- 来源：`origin/main` → 分支 `qg/coverage-floor`。
- 缺陷修复：无产品缺陷。
- 新增/优化：无。
- 工程与测试：现有 `npm test` 用 istanbul 统计这四个文件（Workers 池拒绝 v8/c8，因为没有 `node:inspector`）。按文件下限：行 82、分支 73、函数 81、语句 77，大约低于当前最低文件五个点。作业摘要打印合计百分比。不另开一套测试。`tono-core` 的 llvm-cov 没有加：本机 rustc 1.83 编不过该 crate，Linux 作业上再装 llvm-tools 会拉长 Windows CI 的关键路径。
- 验证：带覆盖率的 `npx vitest run` 949 通过，合计行 92.03%、分支 81.09%、函数 90.9%、语句 87.3%。耗时 254 秒。
- 候选/发布：仅源码，无新候选。
- 剩余限制：下限是合计前一次测量减去余量，不是 100%。llvm-cov 未做。
- 续记：下限只在 `npm test`（`vitest run --coverage`）上生效。`ops-contract` 单独跑 `ops-contract-routes.test.ts` 时不再套这四个文件的下限；那次失败是门挂在共享配置上，不是决策拆分。
