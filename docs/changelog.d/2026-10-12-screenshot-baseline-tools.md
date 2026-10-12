## 2026-10-12 · ops 控制台截图基线：nightly 可直接重录，PR 改界面不带基线时提醒
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)），A25 / D9-A 的后续（#1543）。只改 CI 工作流、一条守护测试和 BUILD_AND_TEST；不改产品源码。
- 来源：main → 分支 `ci/screenshot-baseline-tools`；未合 main。
- 缺陷修复：无。
- 新增/优化：
  - `screenshots-nightly.yml` 加 `workflow_dispatch` 输入 `update_baselines`（默认 false）。为 true 时只跑 ops 控制台任务：
    在同一个 `macos-26` 镜像上 `npx playwright test --update-snapshots=changed`，把 `e2e/__screenshots__` 作为 `ops-console-baselines-<sha>` 上传。
    两个 macOS 截图任务跳过；main 上的失败 issue 不追评。定时运行永远只做对比。#1588 那次为了重录得开临时分支改工作流，有了这个输入就不用了。
  - 新工作流 `ops-console-baseline-reminder.yml`：PR 改了 `services/ops-console/src/**` 却没改 `e2e/__screenshots__` 时，给一条 `::warning` 注释和 step summary，写明重录命令。
    不进 `ci-gate`，不是必需检查，不会失败。#1543 的 110 处漂移就是 D9-A 之后控制台改版没人重录、PR 门又不比像素攒出来的。
- 工程与测试：`screenshot-nightly-split.test.mjs` 加一条用例：`update_baselines` 是默认 false 的 dispatch 输入，`--update-snapshots` 只出现一次，并且只在 `if: ${{ inputs.update_baselines }}` 的那一步里。
- 验证：`node --test tooling/scripts/tests/screenshot-nightly-split.test.mjs tooling/scripts/tests/ci-gate-changes.test.mjs` 10/10 通过；dispatch 运行结果见 PR。
- 候选/发布：无。
- 剩余限制：提醒只看路径，不判断改动是否可见；账目浅色页在重录模式下可能卡在 Playwright 的字体等待（#1588），工作流注释里写了绕过办法。
