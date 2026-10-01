## 2026-09-30 · Windows 已连接状态改为一句话
- 归属：界面/零配置改进（2026-09-30 已批准的 UI 提案第 3 项）；不是 SHIP_PLAN §2 第 10 项修复，G4 冻结期间不合入。影响 Windows 首页连接按钮下方的说明和「节点」卡片的副标题。
- 来源：基线 main `d2363002` → 分支 `cursor/windows-connected-tagline-b9f5`；未合 main。草稿：`dashboard.test.tsx` 与 #706 重叠。
- 缺陷修复：无。
- 新增/优化：已连接时，按钮下方和「节点」卡片原来是一整段分流说明（「国内直连未开，微信也走隧道。Claude / ChatGPT / Cursor 仍走家里宽带。」或直连开启时的同类长句），现在改为已有文案「流量已保护；断线不会漏 IP。」。只有国内直连被跳过（`directOverlay === 'skipped'`）时仍显示原来的说明。分流细节仍在节点卡片的「查看规则」和活动页。
- 工程与测试：`dashboard.test.tsx` 新增一个用例：已连接且直连开启时显示一句话，不再出现分流长句。
- 验证：`pnpm exec vitest run src/pages/tono/dashboard.test.tsx` 通过（23 个测试）；`eslint --max-warnings=0` 通过。前后截图见 PR（预览 fixture 临时改为没有失败记录，只为截图，未提交）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：无。
