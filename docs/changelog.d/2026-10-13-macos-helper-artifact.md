## 2026-10-13 · macOS CI：特权 helper 只编译一次

- 归属：工程流程（CI 提速），不属于 SHIP_PLAN 门或运维计划条目。只改 `macos-ci.yml`。不改 helper 源码、签名或发布工作流。
- 来源：main `00ba688c2` → 分支 `cursor/macos-helper-artifact-ef49`。未合 main。
- 缺陷修复：无。
- 新增/优化：新增 `helper` 作业（`macos-26`）编译 `tono-core-helper` 并上传二进制和 `tono-core-helper.built`。`build`、`unit-tests`、`privileged-tests` 下载后放回原路径，不再各编一次。`policy-tests` 不依赖 helper。跳过条件仍由 `sing-box-input` 决定；helper 失败时三个消费作业不跑。必选检查名仍是 `ci-gate`。
- 工程与测试：`tooling/scripts/tests/macos-helper-artifact.test.mjs`。`macos-release.yml` 与 `screenshots-nightly.yml` 仍各自调用 `build-core-helper.sh`，本 PR 不改它们的输入。
- 验证：本地 `node --test tooling/scripts/tests/macos-helper-artifact.test.mjs` 与 `macos-ci-skip-duplicate.test.mjs`。托管 macOS / ci-gate 待本 PR。未在 Linux 上跑 `xcodebuild`。
- 候选/发布：无新包。
- 剩余限制：`helper` 等 `sing-box-input` 结束才开始，三个消费作业因此晚启动大约一次 helper 编译（此前这时间花在各自作业内部）。峰值仍是四个 `macos-26`：helper 与 `policy-tests` 重叠，随后才是 build / unit-tests / privileged。发布工作流不复用这个产物。
