## 2026-10-12 · Mac 与 Windows 图标换成日出（sun on the horizon）
- 归属：SHIP_PLAN G1/G2 的外观部分（所有者 2026-10-12 批准品牌图，[决策 095](../decisions/095-2026-10-12-sun-horizon-icons.md)）；UI PR，所有者看图后合并。
- 缺陷修复：无。
- 新增/优化：旧的 "TO" 渐变图标全部换成已批准的日出图标。
  - Windows：应用图标与安装包图标（`icon.ico`、`icon.png`、Store 磁贴等）、托盘三态图标（未连接或连接中：灰色空心日出；已断网保护：橙色日出加斜线；已保护：暖色实心日出；状态映射不变）、
    NSIS 安装向导的页眉与侧栏图片（新增 `headerImage` / `sidebarImage`）、界面 logo（`TonoLogo`，海景标题栏用无底板的日出）、
    海景启动画面、欢迎页大图标、网页 favicon。
  - macOS：应用图标（Dock/Finder，按 macOS 图标网格留边加阴影）、界面 logo（`TonoMark`）、欢迎页大图标；菜单栏六个保护状态改用同一套日出模板图（只有已保护是实心日出；连接中为断开的弧，未连接为空心弧，状态未知为空心弧加感叹号，降级为实心加感叹号，已断网保护为加斜线），状态映射不变。
  - 应用内不再有通用盾牌图标。Mac：首页保护卡片用日出（已保护实心）、断网保护提示用菜单栏同一套状态图、账号不可用用账号徽标、
    目录状态用对勾/感叹号圆圈、安全 DNS 用网络、诊断报告用文档、恢复提示用刷新圆圈、"由 Tono 管理"用锁。Windows：目录节点徽标用线条日出，体检按钮用脉搏线。
  - 发布中心网页 favicon。
  - 删除不再引用的 `tray-icons.svg`（2026-10-06 的四态托盘草图，状态与两端实际状态不对应）、`logo.svg`、`logo.png`、`logo-mask.png`、`tono-mark-mono.svg`。
- 工程与测试修正：`apps/windows/app/scripts/generate-tono-icons.py` 改为从品牌图生成全部位图；16/24/32/48/64/128/256 直接用手工像素对齐的 PNG，按字节打进 ICO。
  `scripts/sea-brand-assets.test.mjs` 改为断言安装包图标与安装向导图片就是批准的那份；新增 XCTest `MenuBarStatusImageTests`：六个状态各有一张不同的 18pt 模板图。
- 验证（Linux，Node 22）：`node --test scripts/sea-brand-assets.test.mjs scripts/windows-packaging.test.mjs` 40 通过；`npx vitest run` 60 文件 414 通过；
  `pnpm typecheck` 通过。Swift/Xcode 资源编译、NSIS 打包与真机显示未在本机运行，交 hosted CI 与所有者真机。
- 候选/发布：仅源码，无新候选。
