## 2026-10-06 · Windows 新外观 PR 4：组件与文案基础
- 归属：`docs/SHIP_PLAN.md` 0.0.75 UI，ROUND-3 §6；沿用 provisional 决策 063，默认关闭。
- 来源：#1406 `079cef47` → 本 PR head；`codex/windows-ui-pr4-20261006`，stacked draft，未合 main。
- 缺陷修复：无；本次不更改保护语义、连接或路由服务。
- 新增/优化：局部 sea 字体/颜色/空间/曲面 tokens；按钮、字段、标签、Tabs、分段、开关、行、面板、Popover/Sheet、现有安全确认 Dialog、attention/empty/skeleton/signal 组件；Toast 兼容原单参数 API 并可指定三种提示类型。旧组件 API 保留，新外观才改变 token 外观。
- 文案：中文客户文字统一“线路”和六种状态；复制诊断的 `support.summary.node` 保留“节点”。英文保留 server/current nouns（托盘两处 node 改 server），Standby 改 Not connected。完整 before/after 表在 PR body；临时导航 key 已删除，恢复共用现有 keys。旧外观仅这些文字变化。
- 工程与测试：新增 Tabs 键盘、开关和 Toast-kind 窄回归；旧 dashboard/tray 测试仅更新文字断言。实际旧文案断言先失败：dashboard9failed/17passed；更新后全套首次仅tray旧文案3failed/356passed；随后只改对应断言复跑。
- 验证：MacBook 前端窄5文件20tests +Toast1test pass；typecheck pass（79/baseline79）；Vite build pass；新代码 ESLint0warnings/Biome pass。全套结果见本 PR comment。修改文件全 lint 另有既有 ProtectedOfflineBanner set-state-in-effect / ServicePrereq optional-chain 提示，不改保护代码压掉提示。
- 视觉：dev-only gallery `pnpm exec vite --config vite.ui-preview.config.mts`，不进入生产入口；ego TaskSpace23 已实际截图 cool/warm、confirm、hover/focus。Cancel 默认聚焦，Escape关闭且回到Confirmation opener。完整每控件pressed/disabled矩阵与六页旧外观像素基线未完成。
- 候选/发布：仅源码，无包、签名、安装或客户发布。Windows/WebView2/RDP/低端机与owner验收未运行；CI以准确head为准。
