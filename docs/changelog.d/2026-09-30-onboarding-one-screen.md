## 2026-09-30 · 首次启动介绍合并为一屏
- 归属：界面/零配置改进（2026-09-30 已批准的 UI 提案第 1 项）；不是 SHIP_PLAN §2 第 10 项修复，G4 冻结期间不合入。影响 macOS 与 Windows 首次启动介绍页。
- 来源：基线 main `d2363002` → 分支 `cursor/onboarding-one-screen-b9f5`；未合 main。
- 缺陷修复：无。
- 新增/优化：四步介绍（跳过、圆点、下一步、渐变文字按钮）改为一屏：标题「欢迎使用 Tono」、三条承诺、一个与登录页同款的实心主按钮「开始使用 →」。Esc 仍可离开并记为已看过。`WelcomeLaunchGate`（何时显示介绍）不变；不改连接、断开、fail-closed 或网络代码。设计说明同步更新 `docs/welcome-v2.md` §3。
- 工程与测试：`intro.test.tsx` 改为一屏断言（三条承诺、唯一按钮且获得焦点、点击/按 Esc 写入 `tono.introSeen` 并跳转登录）。
- 验证：Windows `pnpm exec vitest run src/pages/tono/intro.test.tsx src/pages/_layout` 通过（3 个文件，26 个测试）；`eslint --max-warnings=0`、`tsc --noEmit` 通过；桌面预览截图前后对比见 PR。macOS XCTest 未运行（此主机无 Xcode），macOS 仅源码改动，未渲染截图。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`tono.intro.skip`、`tono.intro.next`、`tono.intro.progress`（Windows）及 macOS 的 `Skip`、`Continue` 文案键不再被介绍页使用，未删除，留待避开 #706 的 `tono.json` 后清理。
