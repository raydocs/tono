## 2026-10-02 · Windows 发布构建自带 sing-box alpha.9 输入
- 归属：G4 发布构建（Windows）；`.github/workflows/windows-release.yml`，修 #1313。
- 来源：main `361a64b8` → 本 PR。
- 缺陷修复：`windows-release.yml` 的 `build-draft` 在 Service 构建步骤解析 `sing-box-x86_64-pc-windows-msvc.exe`，但 workflow 里没有任何一步生成它（#1159 起二进制不在 git），发布构建会在 prebuild 前后失败。照 #1312 的候选 workflow 加 `sing-box-input` job（ubuntu，`needs: branch`，跑 `tooling/scripts/prepare-windows-sing-box.sh`，只接受固定摘要 `b2e6902e…`），`build-draft` 增加 `needs` 并把 artifact 下载到 sidecar 目录。`qualify` → `branch` 的守卫、`windows-release` 环境审批、build-draft 内的摘要校验、`persist-credentials: false` 均未改动。
- 新增/优化：无。
- 工程与测试修正：`windows-ci-paths.test.cjs` 12/12、`windows-packaging.test.mjs` + `validate-windows-channel.test.mjs` 43/43、`macos-candidate-workflow.test.rb` 通过（本机 node/ruby）。`release/windows` 分支需要在本 PR 合入 main 后带上此改动才能生效；未派发 windows-release。
