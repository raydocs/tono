## 2026-10-10 · 合并分支清理脚本：空闲时长不再因毫秒取整变成负数
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)；A26 的后续工程修正（`tooling/scripts/prune-merged-branches.mjs`）。
- 来源：基线 origin/main 3d973f95 → 分支 `amp/fix-prune-merged-branches-flake`；未合 main。
- 缺陷修复：`worktrees` 模式的空闲时长 = `Date.now()`（整毫秒）− HEAD/index/reflog 的 `mtimeMs`（可到亚毫秒，时钟偏差时还可能在未来）。
  worktree 在同一毫秒内刚写过 index 时差值为负，`--min-idle-hours 0` 仍会以「touched in the last 0h」保留它。
  现在空闲时长以 0 为下限：0h 真正关闭守卫；默认 24h 下，未来的 mtime 仍按刚动过处理而保留（不放松）。
- 新增/优化：无。
- 工程与测试：ci-gate run 38066396683 第 1 次尝试（services / ops-contract）里
  `prune-merged-branches.test.mjs` 的 worktree 用例偶发失败：skip-worktree 的 worktree 刚由 `git update-index` 写过 index，
  期望「skip-worktree or assume-unchanged entries」，实际「touched in the last 0h」。新增一个用例，用 `utimesSync`
  把 index mtime 设为注入的 `now` 之后 0.5ms，钉住 0h 选中、24h 保留；不用 sleep，不重试。
- 验证：Linux，Node 24.18.0。新用例在未修改脚本上失败（`actual: []`，`expected: ['merged']`），修复后通过。
  `node --test tooling/scripts/tests/prune-merged-branches.test.mjs` 连跑 50 次：50/50 退出 0，每次 `tests 5 / pass 5 / fail 0`。
  `tooling/scripts/tests/*.test.mjs` 全量：119 通过；2 个失败只因本 worktree 未在 `services/ops-console` 执行 `npm ci`（缺 `js-yaml`），与本改动无关，CI 会安装。
- 候选/发布：仅源码，无新候选。
- 剩余限制：本机内核 6.1 的文件时间戳是粗粒度，自然条件下复现不了；根因来自 CI 日志和注入的 mtime，不是在本机自然复现的。
