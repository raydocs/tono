## 2026-10-02 · Windows 候选构建自带 sing-box alpha.9 输入
- 归属：G1 候选构建（Windows）；`.github/workflows/windows-candidate.yml`、`tooling/scripts/prepare-windows-sing-box.sh`。
- 来源：main `817aed2a` → 本 PR。
- 缺陷修复：#1159 起 Windows 安装事务要求 `sing-box.exe`，但二进制不在 git 里，候选 workflow 也没有生成它；[run 36937255752](https://github.com/raydocs/tono/actions/runs/36937255752) 在 prebuild 报 `missing ... sing-box-x86_64-pc-windows-msvc.exe`。改后新增 `sing-box-input` job（ubuntu），照 macOS 的 `prepare-macos-sing-box.sh` 从固定 commit `132b38e9` 用 go1.27.1 重建 windows-amd64-v2，校验 manifest（`6a14337f…`，即仓库内 `manifests/alpha9/windows-amd64-v2.json`）和二进制摘要 `b2e6902e…`，不符即失败；build job 下载后放到 sidecar。
- 新增/优化：无。
- 工程与测试修正：`windows-ci-paths.test.cjs` 12/12 通过（本机 node）。`windows-release.yml` 有同样缺口，另开 issue，不在本 PR。
- 候选：本 PR 分支上派发一次 Windows 候选作为证明；合入后在同一 main 重出 macOS + Windows 候选。
