## 2026-10-13 · Windows 与 services CI：release 快进不再重复排队

- 归属：工程流程（CI 提速），不属于 SHIP_PLAN 门或运维计划条目。改 `windows-ci.yml` 和 `services-ci.yml`。不改产品、签名或发布工作流，也不改 macOS 的跳过判定。
- 来源：main `00ba688c2` → 分支 `cursor/release-duplicate-skip-ef49`。未合 main。
- 缺陷修复：无。
- 新增/优化：两个工作流各加一个 ubuntu 作业 `release-duplicate`。push 到 `release/macos` 或 `release/windows` 时，若该 SHA 已在 main（compare 为 identical 或 behind，且 ahead_by 为 0），其余作业的 `if` 不成立，Windows runner 和 services 作业都不排队。判定脚本与 macOS 相同（`macos-ci-skip-duplicate.mjs` 的 release 参数）。不在 main 上的提交照常跑。`pull_request` / `workflow_dispatch` / `workflow_call` 不跳过。compare API 失败时不跳过。`push` 的分支列表仍含两条 release 线。必选检查名仍是 `ci-gate`。
- 工程与测试：跳过接线写在各自的 `release-duplicate` 作业里，不新增 `tooling/scripts/**` 测试文件，因此这次改动不会把 macOS 套件排队。没有让 `app-rust` 依赖 `core`。
- 验证：本地抽出两段接线脚本并 `yaml.safe_load` 两个工作流。ci-gate 待本 PR。
- 候选/发布：无新包。
- 剩余限制：每次 PR 多一次 ubuntu checkout（约十几秒）才开始原来的作业。main 上的 push 不在本 PR 的跳过范围。
