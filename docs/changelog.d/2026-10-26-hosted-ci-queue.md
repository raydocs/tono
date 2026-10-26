## 2026-10-26 · 托管 CI 队列：发布 ref 门不再占 macOS 跑者，删掉指向已删分支的 push 触发

- 归属：ops（CI 工作流）；影响 macOS 发布、Windows 候选与安装冒烟三个工作流。只改 `.github/workflows`，不改产品源码。
- 来源：main `0b5f30b06` → 分支 `ci/hosted-macos-queue`；未合 main。
- 缺陷修复：无。
- 新增/优化：
  - `macos-release.yml` 的 `branch`（ref 门）从 `macos-26` 改到 `ubuntu-24.04`。它只是一段 bash，却要等一个 macOS 跑者：[run 39699940479](https://github.com/raydocs/tono/actions/runs/39699940479) 里排队 52.6 分钟才跑了 6 秒，之后 `build` 又排了 8 分钟。门的脚本和判断不变。
  - `windows-candidate.yml` 删除对 `stability/desktop-0.0.72-20260908`、`cursor/ship-plan-first-publish-d57f` 的 push 触发（两个分支都已删除；注释本来写着 G1.1 后删除）。`windows-installer-smoke.yml` 删除对同一已删分支的 push 触发。两者保留 `workflow_dispatch`（候选还保留 `workflow_call`）。
- 工程与测试：无代码改动。`macos-candidate-workflow.test.rb` 照旧在本地执行同一段 ref 门脚本。
- 验证：本地 checkout `0b5f30b06` 加本改动：`ruby tooling/scripts/tests/macos-candidate-workflow.test.rb` 通过；`node --test tooling/scripts/tests/windows-ci-paths.test.cjs tooling/scripts/tests/ci-gate-changes.test.mjs tooling/scripts/tests/macos-ci-skip-duplicate.test.mjs` 27 项通过；三个工作流能被 YAML 解析。未执行：真实派发一次 `macos-release`（ref 门在 ubuntu 上跑的仍是同一段 bash）。
- 候选/发布：无新包。
- 剩余限制：macOS 队列的大头不在这里。`ios-ci.yml` 的 `apple` 任务每次 push main 触及 `apps/ios/**` 就占一个 `macos-26` 跑者约 60 分钟（模拟器截图 19 分钟、UI 测试加无障碍审计 26 分钟），最近 12 次有 9 次失败（38 个 UI 用例里 1 个失败）；`windows-core.yml` 在 `macos-26` 上交叉编译 Windows 核心约 3 分钟。是否把 iOS 模拟器两步移到 nightly（同 2026-10-10 D9-A 的做法）由所有者决定。`desktop-update-candidate.yml` 自 2026-09-22 加入后从未运行过。Windows 发布 `build-draft` 曾在 `windows-2025` 排队 45 分钟（[run 39699942785](https://github.com/raydocs/tono/actions/runs/39699942785)），是托管池的事，仓库里改不了。
