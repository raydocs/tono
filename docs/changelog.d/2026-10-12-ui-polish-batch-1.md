## 2026-10-12 · UI 美化第一批：内页保留海面背景、活动空态插画、标题字重
- 归属：G1（客户 0.0.75 的 UI 打磨，所有者 2026-10-12 05:01Z 批准开始做）；Mac 与 Windows 应用壳。
- 来源：基线 main 56523e3b；分支 `claude/project-thread-k38dgr`；未合 main。
- 缺陷修复：无。
- 新增/优化：
  - 内页（线路、活动、账号、支持、设置）不再只有一层纯色渐变：已挂载并暂停的首页场景以 0.7 不透明、14px 模糊留在地面渐变（0.45）之下。
    首页、登录、欢迎页各自画完整场景，托盘无场景，均不变。Windows：`tono-layout.tsx` 的 `seaBackdropDimmed()` 写 `data-sea-dimmed`，
    `sea-shell.css` 取值；Mac：`SeaBackdropDim.resolve(home:reduceTransparency:)`，`ContentView` 取值；「降低透明度」开启时沿用原来的不透明地面。
  - 活动页空态加一枚月牙加海平线的单色记号（Windows `SeaEmpty art`，Mac `SeaEmptyMark`），文案不变。
  - 标题字重：Windows `--tono-weight-title` 650→600、`--tono-weight-chip` 750→700（Microsoft YaHei UI 没有 650，会向上取 Bold），
    海面外观页标题 300→400；Mac `SeaPageHeading` 与线路页标题 `.light`→`.regular`。首页大标题（56/300）与欢迎页标题不变。
    旧（classic）壳内联写死的 `fontWeight: 650` 未改。
- 工程与测试：`tono-layout.test.tsx` 加一个 `it`（哪些路由压暗）；新增 `SeaBackdropDimTests.swift`。
- 验证（Linux 容器，Node 22）：`vitest run` tono-layout / SeaControls / activity / SeaBackdrop 4 文件 34 个测试通过；`tsc --noEmit` 通过；
  biome format 通过；`npm run lint` 在 main 上本地已有 8 条 react-refresh 警告，本分支不新增错误。Mac XCTest 与编译未在本地执行，等 hosted CI。
  预览截图（Windows 预览壳，Linux Chromium，替代字体，非真机）：/mnt/project-files/reports/ui-polish-20261012/batch1/。
- 候选/发布：仅源码，无新候选。
- 剩余限制：真机（Windows 任务栏 DPI、Mac Retina）未看；模糊在 Mac 上的 GPU 开销按场景已暂停推断，未测量。UI PR，等所有者看图确认后再合。
