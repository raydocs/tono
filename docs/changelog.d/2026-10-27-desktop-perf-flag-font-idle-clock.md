## 2026-10-27 · 桌面端：Windows 旗帜字体子集化；macOS 连接卡片空闲不再每秒重建
- 归属：无发布门（性能，排下一发；不属 SHIP_PLAN §2 第 10 条冻结修复）；Windows 前端 `font.scss`，macOS `DashboardView.swift`。
- 来源：基线 origin/main `6b76cfa`；分支 `amp/desktop-perf-twemoji-timeline`。
- 缺陷修复：无。
- 新增/优化：Windows 内嵌的 Twemoji Mozilla 1,454,532 B TTF 换成只含旗帜的 99,560 B WOFF2 子集（图形不变）并加 `unicode-range`；其余 emoji 走系统 Segoe UI Emoji。前端产物 3,337,248 → 1,982,392 B；brotli（Tauri 内嵌压缩方式）1,487,274 → 867,944 B。macOS `ConnectionProgressCard` 的 1 Hz `TimelineView` 只在连接/断开计时或重试倒计时时每秒走，其余（如显示失败）改为每小时。
- 工程与测试：无新测试（字体资源与重绘节奏无可断言的公共行为）；浏览器渲染对比新旧字体旗帜一致。
- 验证：见 PR 验证评论。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无真实 Windows/Mac 设备与电量计，未测安装包实际体积、空闲 CPU 或耗电；macOS 改动未在本机编译，以托管 CI 为准。
