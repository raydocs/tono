# Windows 设置截图归档 · 2026-10-10

归属：[SHIP_PLAN](../../SHIP_PLAN.md) G2；设置改进来自 [PR #1546](https://github.com/raydocs/tono/pull/1546)，
已合入 main。本目录仅归档截图，不改产品、生成候选或推进客户更新源。

- 改进前源码：[e421d3a4ce5749a5b7dd4248dd5c36cab6725729](https://github.com/raydocs/tono/commit/e421d3a4ce5749a5b7dd4248dd5c36cab6725729)。
- 改进后源码：[2012443b5a9128813ca3843163e877bf5804a2fc](https://github.com/raydocs/tono/commit/2012443b5a9128813ca3843163e877bf5804a2fc)。
- 渲染方法：Windows 生产 React 设置组件，在 Linux orb 的 Chromium 中运行；隐私读取/保存使用合成 IO，DPR 2。
  **不是 Windows 原生 WebView、真机或 macOS 截图，不是 PF/WFP 或真实上传行为验收。**
- 共 11 张已检查 PNG：基线 1 张、最终源码 10 张。保留原文件名与字节；不包含被替代的 `ff95a34dd` 截图、缓存或个人数据。
  默认页截图只覆盖当时视口，底部“关于”卡片未完整显示。

| 状态 | 截图 |
|---|---|
| 改进前，中文默认页 | [before](windows-settings-before-e421d3a-zh.png) |
| 改进后，中文默认页 | [default](windows-settings-after-2012443b5-default-zh.png) |
| 正在读取，选择禁用 | [reading](windows-settings-after-2012443b5-reading-zh.png) |
| 正在保存，不提前确认 | [saving](windows-settings-after-2012443b5-saving-zh.png) |
| 离开并返回设置，保存锁仍保留 | [navigation-saving](windows-settings-after-2012443b5-navigation-saving-zh.png) |
| 保存回执成功后显示已保存 | [saved](windows-settings-after-2012443b5-saved-zh.png) |
| 读取失败，提供重新读取入口 | [read-error](windows-settings-after-2012443b5-read-error-zh.png) |
| 保存失败，实际值未知，要求重新读取 | [save-error](windows-settings-after-2012443b5-save-error-zh.png) |
| 保存失败，技术详情展开 | [error-details](windows-settings-after-2012443b5-error-details-zh.png) |
| 英文窄窗口，保存失败 | [narrow-error](windows-settings-after-2012443b5-narrow-error-en.png) |
| 开发专用旧外观浅色兼容，保存失败；非客户外观 | [legacy-light-error](windows-settings-after-2012443b5-legacy-light-error-zh.png) |

## 证据边界与待验

原改进的独立 Sol 评审覆盖上述改进后准确 head；[原 CI](https://github.com/raydocs/tono/actions/runs/38075381915)
使用 PR merge ref，前端 58 files / 402 tests passed。这是沿用的代码证据，不是本归档 PR 的新产品测试。
截图说明外观；导航保持禁用与成功回执后的状态曾以浏览器 DOM 检查，不能仅凭静态图证明时序。

Windows 真机 WebView2、真实 IPC 延迟/失败、原生导航、实际持久化与上传取消仍待验；
合成预览中指针设置导航不稳定，仅键盘导航成功，不据此推断原生缺陷。macOS 未在本轮修改或验收。
登录、连接、Protected Offline、解除保护及 PF/WFP/helper 不由本截图集验收。
