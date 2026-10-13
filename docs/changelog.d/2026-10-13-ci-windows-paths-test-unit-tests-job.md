## 2026-10-13 · CI：windows-ci-paths 测试跟随 macOS TonoTests 新 job
- 归属：工程流程（CI 修复），不属于 SHIP_PLAN 门或运维计划条目。
- 工程与测试修正：#1611 把 TonoTests（含 `TEST_RUNNER_TONO_EMIT_UPDATE_CONTRACT` 步骤和合约字节检查）从 `macos-ci.yml` 的 `build` job 移到 `unit-tests` job，`windows-ci-paths.test.cjs` 仍在 `build` 里找这两个步骤，导致 main 之后所有 PR 的 `windows / app` 失败。测试改为在 `unit-tests` job 里找，断言本身不变。
- 验证：本机无 `apps/windows/app` 的 pnpm 依赖，测试无法运行（与 origin/main 同样 MODULE_NOT_FOUND）；结果见 PR 的托管 CI。
- 候选/发布：仅源码，无新候选。
