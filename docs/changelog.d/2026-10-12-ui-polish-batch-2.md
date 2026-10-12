## 2026-10-12 · UI 美化第二批：登录玻璃卡片、卡片质感、暖色控件与悬停动效
- 归属：G1（客户 0.0.75 的 UI 打磨；所有者 2026-10-12 05:51Z 问还有哪些可继续优化，线程按"往好看做"的方向继续）；Mac 与 Windows 应用壳。
- 来源：基线 main 6f0a7f7b（#1584、#1585 已合入）；分支 `claude/project-thread-k38dgr`；未合 main。
- 缺陷修复：无。
- 新增/优化：
  - Windows 海面登录页：表单放进一张深色玻璃卡片（`.sea-login-card`，`rgb(23 21 28 / 0.78)` + 24px 背景模糊），页面顶部留 72px，
    卡片脚落在海平线之上，邮箱输入框不再被地平线切开；Mac 登录页本来就是抬离海平线的玻璃卡片，未改。
  - 焦点环统一为日出暖色：Windows `--tono-sea-focus` 不再随冷/暖 tone 切换（`#ffd9a0`），`[data-sea-ui]`、验证码格子同样；Mac `SeaFieldSurface`
    聚焦描边改为 `SeaTheme.attention`（1.5pt）。冷/暖 tone 仍只决定链接与选中色。
  - 开关打开态改为日出渐变（Windows `.sea-toggle[aria-checked="true"]`，Mac `SeaToggleStyle`）；分段选择器选中项改为暖色底
    （Windows `.sea-segmented [aria-pressed]`，Mac `SeaChoice`）；已连接时顶部导航的选中胶囊染日出暖色（`[data-sea-tone="warm"]`）。
  - 卡片质感：`.sea-panel` 加 1px 边、外阴影和 18px 背景模糊，内页背后压暗的海面透进卡片；主按钮带暖色光晕并在悬停时抬起 1px。
  - 线路页：行悬停暖色底，选中行加 2px 日出左边线（Windows `.sea-line-row`，Mac `SeaWarmRowSurface`）；推荐卡悬停抬起并带暖色边光；"推荐"标签改暖色。
    所有过渡遵守 `prefers-reduced-motion` / Mac 减少动态效果。
- 工程与测试：Windows `login.test.tsx` 新增"海面登录表单在玻璃卡片内"一例；Mac `SeaControlsTests` 新增 `SeaWarmRowSurface.washOpacity` 一例。
- 验证（Linux 容器，Node 22）：vitest `login`、`servers`、`settings` 通过；`tsc --noEmit`、biome format 通过。Mac 编译与 XCTest 未在本地执行，交由 hosted CI。
  预览截图（Windows 预览壳 + Linux Chromium，替代字体，静态，不是真机）：项目文件 `reports/ui-polish-20261012/batch2/`。
- 候选/发布：无新包，仅源码。
- 剩余限制：无真机观感；悬停与按下动效在静态截图里看不到；玻璃模糊的 GPU 开销需真机确认（所有者：用户没有低端机）。
