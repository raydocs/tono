## 2026-10-12 · Mac 与 Windows 图标换成日出（sun on the horizon）
- 归属：SHIP_PLAN G1/G2 的外观部分（所有者 2026-10-12 批准品牌图，[决策 095](../decisions/095-2026-10-12-sun-horizon-icons.md)）；UI PR，所有者看图后合并。
- 缺陷修复：无。
- 新增/优化：旧的 "TO" 渐变图标全部换成已批准的日出图标。
  - Windows：应用图标与安装包图标（`icon.ico`、`icon.png`、Store 磁贴等）、托盘三态图标（保留灰/橙/绿状态点）、
    NSIS 安装向导的页眉与侧栏图片（新增 `headerImage` / `sidebarImage`）、界面 logo（`TonoLogo`，海景标题栏用无底板的日出）、
    海景启动画面、欢迎页大图标、网页 favicon。
  - macOS：应用图标（Dock/Finder，按 macOS 图标网格留边加阴影）、界面 logo（`TonoMark`）、欢迎页大图标；菜单栏仍是表示保护状态的六个符号，不变。
  - 发布中心网页 favicon。
  - 删除不再引用的 `logo.svg`、`logo.png`、`logo-mask.png`、`tono-mark-mono.svg`。
- 工程与测试修正：`apps/windows/app/scripts/generate-tono-icons.py` 改为从品牌图生成全部位图；16/24/32/48/64/128/256 直接用手工像素对齐的 PNG，按字节打进 ICO。
  `scripts/sea-brand-assets.test.mjs` 改为断言安装包图标与安装向导图片就是批准的那份。
- 验证（Linux，Node 22）：`node --test scripts/sea-brand-assets.test.mjs scripts/windows-packaging.test.mjs` 40 通过；`npx vitest run` 60 文件 414 通过；
  `pnpm typecheck` 通过。Swift/Xcode 资源编译、NSIS 打包与真机显示未在本机运行，交 hosted CI 与所有者真机。
- 候选/发布：仅源码，无新候选。
