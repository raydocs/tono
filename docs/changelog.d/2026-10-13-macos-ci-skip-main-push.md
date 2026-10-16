## 2026-10-13 · macOS CI：main 上已测过的合并提交不再排队

- 归属：工程流程（CI 提速），不属于 SHIP_PLAN 门或运维计划条目。只改 `macos-ci.yml` 和跳过判定。不改产品、签名或发布工作流。
- 来源：main `00ba688c2` → 分支 `cursor/macos-ci-skip-main-push-ef49`。未合 main。
- 缺陷修复：无。
- 新增/优化：push 到 `main` 时，若该 SHA 已有一次跑完且成功的 macOS 套件（合并队列测的就是将要落到 main 的 SHA），或这是一次合并提交、相对第二父提交的 macOS 路径为空、且该父提交的套件成功，则四个 `macos-26` 作业不排队。直接推到 main、冲突改了 macOS 路径、ci-gate 因路径跳过了 macOS、compare 文件列表达到 300 或 API 失败，都不跳过。release 线「已在 main」的跳过保留。`pull_request` / `workflow_dispatch` / `workflow_call` 不跳过。必选检查名仍是 `ci-gate`。
- 工程与测试：`tooling/scripts/macos-ci-skip-duplicate.mjs` 与 `tooling/scripts/tests/macos-ci-skip-duplicate.test.mjs`。四个 macOS 作业没有合并。
- 验证：本地 `node --test tooling/scripts/tests/macos-ci-skip-duplicate.test.mjs`。托管 macOS / ci-gate 待本 PR。
- 候选/发布：无新包。
- 剩余限制：合并提交相对 PR 头改了 macOS 路径时仍会再跑一整套（覆盖没测过的合并结果）。对同 SHA 的 push 重跑，若上一次套件已成功，会跳过；要用 `workflow_dispatch` 再跑。Windows / services 的 release 快进不在本 PR。
