## 2026-09-30 · Windows「实时流量」卡片显示本次连接用量
- 归属：界面/零配置改进（2026-09-30 已批准的 UI 提案第 5 项）；不是 SHIP_PLAN §2 第 10 项修复，G4 冻结期间不合入。影响 Windows 首页「实时流量」卡片的副标题。
- 来源：基线 main `d2363002` → 分支 `cursor/windows-session-traffic-b9f5`；未合 main。草稿：`tono.json` 和 `dashboard.test.tsx` 与 #706 重叠。
- 缺陷修复：无。
- 新增/优化：已连接且流量数据已到时，副标题从「↑ 18.0 KB/s」变为「↑ 18.0 KB/s · 本次连接 1.24 GB」。合计取核心 `/traffic` 已有的 `upTotal + downTotal`（核心随连接启停），只在本机显示，不上传。合计为 0 或还没收到数据时，行为和原来一样。新文案键：`tono.dashboard.overview.sessionTotal`（中英文），并重新生成了 i18n 类型。
- 工程与测试：`dashboard.test.tsx` 新增一个用例（1 GB 合计显示在上传速率旁）；测试 mock 的流量类型补上 `upTotal` / `downTotal`。
- 验证：`pnpm exec vitest run src/pages/tono/dashboard.test.tsx` 通过（23 个测试）；`eslint --max-warnings=0`、`tsc --noEmit` 通过。前后截图见 PR（预览 fixture 临时改为有实时流量，只为截图，未提交）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：核心在连接中途重启（例如切换节点或恢复重连）时，合计会从 0 重新计数。
