## 2026-10-12 · macOS CI：TonoTests 与 Release 构建并行
- 归属：工程流程（CI 提速），不属于 SHIP_PLAN 门或运维计划条目；所有者 2026-10-12 要求在 GitHub 托管 runner 上减少等 CI。
- 工程与测试修正：`macos-ci.yml` 的 `build` 原来先编 Release（打包、上传候选产物），再在同一 job 里编 Debug 跑 TonoTests，两次编译串行（2026-10-05..12 抽样：Release 约 3.2 分钟，TonoTests 约 4.7 分钟，job 中位 10.7 分钟）。TonoTests 及其后的合约/运行时字节检查和结果上传移到新 job `unit-tests`（同样 `needs: sing-box-input`、`macos-26`、同一 `TONO_UPDATE_RELEASE_SEQUENCE`，自行下载 sing-box 并构建 helper），与 `build` 并行。`build` 的 Release 产物、`dirty:false` 检查、打包与上传不变；调用方（ci-gate、desktop-update-candidate）仍等整个 macOS CI 全部 job 通过。
- 预期：macOS 关键路径从约 12.5 分钟（1.8 + 10.7）降到约 8 分钟；多用一台 macOS runner（公开仓库不计费）。
- 验证：本机 `node --test` 跑 `screenshot-nightly-split`（2 通过）、`ci-gate-changes`（8 通过）、`peer-auth-mode`（3 通过）。未运行：`windows-ci-paths.test.cjs`（需要 `apps/windows/app` 的 pnpm 依赖，在 origin/main 上同样因 MODULE_NOT_FOUND 失败）；macOS job 本身只能在托管 CI 跑，结果见 PR。
- 候选/发布：仅源码，无新候选。

### 续记 2026-10-13 · windows-ci-paths 测试跟随新 job
- #1611 合入后 `windows / app` 在 main 上变红：`tooling/scripts/tests/windows-ci-paths.test.cjs` 在 `macos-ci.yml` 的 `build` job 里找共享更新合约的 XCTest 与结果守卫，而它们已移到 `unit-tests`。#1611 当时把这个测试列为「未运行」（本机缺 pnpm 依赖），没有借用 js-yaml 跑一遍，所以漏掉了。
- 修正：测试改为在 `unit-tests` job 里查找同样的两步，断言不变（仍要求 xcodebuild 执行合约测试、守卫无 `if`、不 `continue-on-error`）。
- 验证：借用 services 的 js-yaml 本机运行该文件：origin/main 358fd9da1 上第 8 条失败（13 通过 1 失败），修正后 14 通过。
