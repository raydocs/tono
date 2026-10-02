## 2026-10-02 · R6 打包扫描报告

- 归属：SHIP_PLAN G1。Windows 与 macOS 的打包、安装、升级、卸载路径。不是客户发布。
- 来源：只读扫描 main 361a64b8，并检查 36e3194d 的两个候选产物（只解包和读签名，没有运行）。报告见 `docs/agent-reports/2026-10-02-R6-packaging-scan.md`。
- 缺陷修复：本 PR 不改代码。R6-1（卸载留下 sing-box pin）在 #1318 修复，那个 PR 需要实机验证，不自动合并。
- 新增/优化：无。
- 工程与测试修正：新开 issue #1317 和 #1319–#1325。
- 验证：用 7zz 解包 Windows 候选，确认四个二进制都在、摘要都对，gate 副本与安装副本逐字节相同。用 ditto 解包 macOS 候选，`codesign -dv` 显示三个可执行文件都是 Developer ID 签名，带时间戳。没有发现会让 36e3194d 候选安装、升级或连接失败的问题。
- 发布与部署：仅文档，无新候选。
- 剩余限制：真实安装、升级、卸载没有跑。`windows-release.yml` 的 sing-box 问题见 #1313（另一个 agent 负责）。
