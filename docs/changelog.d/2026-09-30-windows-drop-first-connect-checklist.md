## 2026-09-30 · Windows 首页去掉「第一次连接」清单
- 归属：界面/零配置改进（2026-09-30 已批准的 UI 提案第 2 项）；不是 SHIP_PLAN §2 第 10 项修复，G4 冻结期间不合入。影响 Windows 首页待机状态。
- 来源：基线 main `d2363002` → 分支 `cursor/windows-drop-first-connect-checklist-b9f5`；未合 main。草稿：`dashboard.test.tsx` 与 #706 重叠。
- 缺陷修复：无。
- 新增/优化：待机时不再显示四条「第一次连接」清单（管理员权限、加密 DNS、浏览器安全 DNS、WebRTC 自测），不再让用户自己排查。只有本机实测到 Windows 加密 DNS 覆盖了网卡 DNS 时，才显示一张卡片：「关掉 Windows『加密 DNS』……」加「打开 Windows DNS 设置」按钮。连接失败后这张卡片隐藏，和原来一样不压在「试用备用通道」上面。已连接时的加密 DNS 提示不变。
- 工程与测试：`dashboard.test.tsx` 改写三个清单用例（待机且 DNS 正常时无清单、无按钮；实测到加密 DNS 时有按钮；握手 eof 失败后提示隐藏）。每次渲染用独立的 SWR 缓存，和 `connect-progress` / `servers` / `support` 测试一致，避免 2 秒去重窗口让用例依赖执行顺序。桌面预览 fixture 新增 `scenario=idle`（没有失败记录的待机）和 `dns=encrypted`。
- 验证：`pnpm exec vitest run src/pages/tono/dashboard.test.tsx` 连跑 3 次，每次 22 个测试全过；`eslint --max-warnings=0`、`tsc --noEmit` 通过。前后截图见 PR。
- 候选/发布：仅源码，无新候选。
- 剩余限制：`tono.dashboard.checklist.*` 中除 `encryptedDns` 外的文案键已经不用，但没有删（`tono.json` 与 #706 重叠）。Chrome/Edge 安全 DNS 的建议不再显示在首页。
