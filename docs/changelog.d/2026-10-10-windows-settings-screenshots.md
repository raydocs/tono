## 2026-10-10 · Windows 设置最终截图永久归档
- 归属：SHIP_PLAN G2；Windows 设置 UI 的文档证据归档。
- 来源：从 main [f761a96b](https://github.com/raydocs/tono/commit/f761a96b58012212afb4f235bbb7781455c504d8)（已合 [#1546](https://github.com/raydocs/tono/pull/1546)）建立 `amp/windows-settings-screenshot-archive`，本 PR；截图源码为改进前 [e421d3a](https://github.com/raydocs/tono/commit/e421d3a4ce5749a5b7dd4248dd5c36cab6725729)、改进后 [2012443b5](https://github.com/raydocs/tono/commit/2012443b5a9128813ca3843163e877bf5804a2fc)。
- 缺陷修复：无新增产品修复，不改写 #1546 的修复或评审结论。
- 新增/优化：将 11 张最终受检 PNG 原样归档到 [截图目录](../screenshots/windows-settings-2026-10-10/README.md)，附源码、状态索引、渲染方法及待验说明；不包含旧 head 的 9 张替代图。
- 工程与测试：docs-only；检查 PNG 完整性、与原图字节一致、README 相对链接和变更范围，无产品测试重跑。
- 验证：原图为 Linux Chromium、合成 IO、DPR 2，已经视觉检查；归档前复核可见内容与 PNG 元数据，不含缓存、凭据或个人数据。沿用 #1546 的准确 head 独立 Sol PASS 与 [CI 38075381915](https://github.com/raydocs/tono/actions/runs/38075381915)，不当作归档 head 的产品测试或真机证据。本 PR 的 docs-only ci-gate 状态以 GitHub 为准。
- 候选/发布：仅文档，无新包、无新候选、无发布或更新源变化；本线程不自行合并，交主线程处理。
- 剩余限制：Windows 原生 WebView2、真实 IPC/持久化/上传取消待验；macOS、登录/连接/保护状态不由这些截图验收。
