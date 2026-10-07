## 2026-10-07 · macOS release 工作流补 hosted-window 验收标志（7502 候选重出）
- 归属：SHIP_PLAN G1/G2 候选构建；macOS 发布工作流，不改 app 源码。老板 2026-10-07「把能合并的合并出候选」（[decision 071](../decisions/071-2026-10-07-sound-default-on-0076-candidates-0075-polish-a.md)）。
- 来源：main `f73300c13` → 本 PR；`release/macos`、`release/windows`、`stability/desktop-0.0.75-20261005` 已于 2026-10-07 16:2x UTC 快进到 `f73300c13`，合入后再快进到本 PR 的 merge SHA。
- 缺陷修复：无产品缺陷。
- 新增/优化：无。
- 工程与测试：#1426 的海景截图测试（`MacUsabilityRenderTests` 14 个 fixture、`MacSeaPolishRenderTests`）在没有 `TEST_RUNNER_TONO_HOSTED_WINDOW_DIAGNOSTIC=1` 时 fail-closed（`XCTFail("… exact-window native acceptance unavailable")`）。`macos-ci.yml` 两处 XCTest 步骤设了它，`macos-release.yml` 的「TonoTests XCTest target」步骤没有，所以 main 上 ci-gate 全绿、而第一条 7502 候选 [run 37651992656](https://github.com/raydocs/tono/actions/runs/37651992656) 在 build job 的 XCTest 步失败（642 tests，14 failures，全部是该消息），未签名、未产包。修法：release 工作流该步骤加同一个 `env`，与 `macos-ci.yml` 一致；不跳过、不放宽任何测试。
- 验证：失败证据 = 上面 run 的 `--log-failed`（14 条 `MacUsabilityRenderTests.swift:560` 同一消息）。本 PR 的证明是合入后重新派发的 macOS release run 通过同一步骤；PR 自身的 ci-gate 对 `.github/workflows/macos-release.yml` 没有被调用的工作流（BUILD_AND_TEST「release or promote workflows need no called workflow」），不构成该步骤通过的证据。MacBook 不跑 xcodebuild。
- 候选/发布：无新包。7502 的 macOS 构建失败；配对的 Windows [run 37651997330](https://github.com/raydocs/tono/actions/runs/37651997330)（`windows-release` 环境按 decision 023 于 2026-10-07T16:36Z 自批准，source `f73300c13`、sequence 7502）不作为候选使用：合入后两端从同一 merge SHA 以序列 7503 重出，Windows `v0.0.75` 草稿会被后一次 run 覆盖。客户 feed、tag、草稿 publish 均未动。
- 剩余限制：`macos-release.yml` 的测试步骤与 `macos-ci.yml` 是两份手写副本，这次的漂移就是这样产生的；合并为一个 reusable workflow 留作后续工程项，不在本 PR 做。
