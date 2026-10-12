## 2026-10-12 · UI 美化第一批：内页保留海面背景、活动空态插画、标题字重
- 归属：G1（客户 0.0.75 的 UI 打磨，所有者 2026-10-12 05:01Z 批准开始做）；Mac 与 Windows 应用壳。
- 来源：基线 main 56523e3b，叠在 #1584（日出图标，分支 `claude/sun-horizon-icons`）之上；分支 `claude/project-thread-k38dgr`，PR #1585；未合 main。
- 缺陷修复：无。
- 新增/优化：
  - 内页（线路、活动、账号、支持、设置）不再只有一层纯色渐变：已挂载并暂停的首页场景以 0.7 不透明、14px 模糊留在地面渐变（0.45）之下。
    首页、登录、欢迎页各自画完整场景，托盘无场景，均不变。Windows：`tono-layout.tsx` 的 `seaBackdropDimmed()` 写 `data-sea-dimmed`，
    `sea-shell.css` 取值；Mac：`SeaBackdropDim.resolve(home:reduceTransparency:)`，`ContentView` 取值；「降低透明度」开启时沿用原来的不透明地面。
  - 内页背后的场景不再暂停（所有者 2026-10-12 05:12Z：要动才好看）：Windows `SeaBackdrop` 去掉 `paused={!active}`，Mac `ContentView` 的 `active: true`。
    动效档位（自动/完整/简洁/静态）、系统减少动态效果与质量探针照旧决定是否动；离开首页时完成的连接，日出在内页（压暗）播放，回到首页不重播。
  - 海面线路页每一行和推荐卡加回每个城市的地标图标（Windows `TonoNodeBadge`，Mac `NodeRouteMark`）；旧外观、首页和托盘一直在用，海面线路页之前只留了收藏星号（所有者 05:12Z 指出）。
  - 暖色统一（所有者 05:20Z：日出暖色好看）：海面线路页的城市地标图标用日出渐变描边、暖色底板（Windows `TonoNodeBadge tone="sunrise"`，
    Mac `NodeRouteMark(gradient:warmTile:)`）；信号柱亮格、账号页流量条、收藏星、空态记号都改为日出渐变或 `#ffd58e`；
    页面冷/暖 tone 仍只决定链接和选中色。"未测速"由三格暗柱改为一枚空心圆点，避免读成"信号弱"（Windows `SeaSignalBars` level 0，Mac `SeaSignalBars` lit 0）。
  - 活动页空态加一枚月牙加海平线的单色记号（Windows `SeaEmpty art`，Mac `SeaEmptyMark`），文案不变。
  - 标题字重：Windows `--tono-weight-title` 650→600、`--tono-weight-chip` 750→700（Microsoft YaHei UI 没有 650，会向上取 Bold），
    海面外观页标题 300→400；Mac `SeaPageHeading` 与线路页标题 `.light`→`.regular`。首页大标题（56/300）与欢迎页标题不变。
    旧（classic）壳内联写死的 `fontWeight: 650` 未改。
- 工程与测试：`tono-layout.test.tsx` 加一个 `it`（哪些路由压暗）；`servers.test.tsx` 加一个 `it`（海面行带城市图标）；`SeaBackdrop.test.tsx` 的离开/返回用例改为断言内页不暂停且返回不重播；新增 `SeaBackdropDimTests.swift`。
- 验证（Linux 容器，Node 22）：`vitest run` tono-layout / SeaControls / activity / SeaBackdrop / SeaScene / servers / TonoAccountCard / dashboard / TrayPanel（最后一轮 5 文件 70 个）通过；`tsc --noEmit` 通过；
  biome format 通过；`npm run lint` 在 main 上本地已有 8 条 react-refresh 警告，本分支不新增错误。Mac XCTest 与编译未在本地执行，等 hosted CI。
  预览截图（Windows 预览壳，Linux Chromium，替代字体，非真机）：/mnt/project-files/reports/ui-polish-20261012/batch1/。
- 候选/发布：仅源码，无新候选。
- 剩余限制：真机（Windows 任务栏 DPI、Mac Retina）未看；内页场景现在持续动画并叠加 14px 模糊，Windows WebView2 与 Mac 的 GPU 开销未测量，低端机上可能需要把内页模糊改小或由动效档位关掉。UI PR，等所有者看图确认后再合。
