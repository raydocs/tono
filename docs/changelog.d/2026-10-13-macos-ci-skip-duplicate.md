## 2026-10-13 · macOS CI：release 分支上已在 main 的提交不再排队

- 归属：工程流程（CI 提速），不属于 SHIP_PLAN 门或运维计划条目。只改 `macos-ci.yml` 和一条守护脚本。不改产品、签名或发布工作流。
- 来源：main `86fe66dca` → 分支 `cursor/macos-ci-skip-duplicate-ef49`。未合 main。
- 缺陷修复：无。
- 新增/优化：`release/macos` 或 `release/windows` 的 push，若该提交已在 `main` 上（compare 为 identical 或 behind，且 ahead_by 为 0），`sing-box-input` 记 skip，四个 `macos-26` 作业的 `if` 不成立，不向 runner 排队。不在 main 上的提交（发布线热修、合并提交）照常跑。`pull_request` / `workflow_dispatch` / `workflow_call`（含 ci-gate）不跳过。compare API 失败时不跳过。`push` 的分支列表仍含两条 release 线。必选检查名仍是 `ci-gate`。
- 工程与测试：`tooling/scripts/macos-ci-skip-duplicate.mjs` 与 `tooling/scripts/tests/macos-ci-skip-duplicate.test.mjs`。`sing-box-input` 每次都跑这条测试。四个 macOS 作业没有合并：未排队时关键路径是 `unit-tests`（约 8 分钟），把 Release `build` 串进去会加长这条路径；`privileged-tests` 会改主机，不与 `policy-tests` 合用。
- 验证：本地 `node --test tooling/scripts/tests/macos-ci-skip-duplicate.test.mjs`。托管 macOS / ci-gate 待本 PR。
- 候选/发布：无新包。
- 剩余限制：同一提交在 main 上的 push 仍会跑完整 macOS CI（合并后的集成检查）。Windows / services 的 release 快进仍会各跑一遍，本 PR 不动它们。跳过时该次 macos-ci 为绿，但四个 macOS 作业是 skipped，不表示在 release 分支上重新编译过。
