## 2026-10-22 · 只改 macOS 发布说明不再排队 macOS CI

- 归属：owner 2026-10-22 选定。0.0.80 准备 PR（#1708）只改发布说明，`apps/macos/**` 仍触发整套 macOS CI，托管 `macos-26` 排队约 30 分钟。
- 新增/优化：`macos-ci.yml` 的 push 路径在 `apps/macos/**` 后加 `!apps/macos/release-notes/**`。macOS CI 的任务都不读这些说明，只有发布流程（`macos-release.yml`、`release-macos.sh`、发布中心生成）读，它们不受影响。Windows 的路径本来就不含 `apps/windows/release-notes`。
- 工程与测试：
  - `ci-gate-changes.mjs` 的 `matchingWorkflows` 和 `macos-ci-skip-duplicate.mjs` 的 `classifyMacosDiff` 按 GitHub `paths` 的规则处理 `!` 排除：按顺序匹配，最后一条命中的规则决定是否选中。
  - 新增「只改 macOS 发布说明不选 macOS」用例（同时改 Swift 仍选中），以及 `classifyMacosDiff` 对发布说明返回 `empty` 的断言。两处都在旧代码上失败。
- 验证：`node --test tooling/scripts/tests/ci-gate-changes.test.mjs tooling/scripts/tests/macos-ci-skip-duplicate.test.mjs` 13 项通过；`macos-ci.yml` 能被 YAML 解析。
- 剩余限制：发布说明和 Swift 代码一起改的 PR 照常跑 macOS CI。本 PR 改了 `tooling/scripts/**`，本身仍会触发一次 macOS CI。
- 审查：独立 Codex（gpt-6.1-sol xhigh）审 `b398782c3`，approve-with-fixes，无 major。两个 minor 已修：`classifyMacosDiff` 的排除规则只跳过 `prefix/` 之内的文件，裸 `apps/macos/release-notes`（目录被换成文件或链接）仍判 `changed`；排除规则带通配符或字符类时返回 `unknown`，不再误判 `empty`。两条新断言在修复前的代码上失败。
