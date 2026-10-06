## 2026-10-06 · Windows 新外观 PR 3：顶栏与页面背景
- 归属：`docs/SHIP_PLAN.md` 0.0.75 UI；ROUND-3 §5 / ROUND-2 C；默认关闭的展示层草稿。
- 来源：#1393 `77d02866` 与可信 main `ba639f6a` 整合至本地 `244e0f02`，再实现本 PR；`codex/windows-ui-pr3-20261006`；未合 main。
- 缺陷修复：无；不把未验收的新增外观记为已发布故障修复。
- 新增/优化：四项导航胶囊、支持/设置图标、其他页面的证据正确状态链接、静态冷/暖/余烬背景；海景跨路由保留并暂停。外观开启时请求 Windows 无边框，关闭时恢复原始装饰；既有原生控制、账号与恢复操作保留。
- 工程与测试：React 前读取本机外观标记并使用暗色 logo/地平线 splash；未放宽 CSP（Tauri 编译期处理本地脚本哈希，参考 https://v2.tauri.app/security/csp/）。新外观强制深色但不改用户保存的主题。新增顶栏和跨路由场景测试。
- 验证：MacBook 前端：完整 vitest 51 文件/357 tests pass；typecheck pass（unchecked 79/baseline79）；变更 TS ESLint/Biome pass；Vite build pass；i18n 扫描 exit0，active en/zh missing0，其他语言既有缺失仍在。首次 lint 的7 warnings已修正，未篡改测试期望。
- 候选/发布：仅源码，无新候选、签名、安装或发布；既有 7501 包不包含本版 UI。
- 剩余限制：六页多语言截图、路由录像与冷启动录像未完成；Windows/WebView2 原生拖动、双击、Alt-F4、Snap/resize、多屏及缩放真机清单未运行。草稿不自动合并，不主张硬件/G1/G2验收。
