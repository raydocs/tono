## 2026-09-30 · 依赖审计只进摘要、不挡合并
- 归属：工程（质量门）；新工作流 `dependency-audit`，不进入 `ci-gate`。
- 来源：`origin/main` → 分支 `qg/dependency-audit`。
- 缺陷修复：无产品缺陷。
- 新增/优化：无。
- 工程与测试：每周一，以及 lockfile / `Package.resolved` 变更时，把 `npm audit --omit=dev`、Windows 前端 `pnpm audit --prod`、`cargo audit` 和 Swift 包钉死版本的末尾写进 job summary。任一步失败仍以退出码 0 结束。不跑 `cargo deny`：再编译一个工具会把这条旁路作业拉得很长，`deny.toml` 仍在仓库里。
- 验证：工作流文件未接入 `tooling/scripts/ci-gate-changes.mjs`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`cargo install` 只在 advisory 作业里发生，不在 `ci-gate` 的关键路径上。跑者没有 cargo 时摘要写明未扫描。
