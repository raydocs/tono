## 2026-10-02 · Windows：Ctrl+K 连接被拒时不再没反应
- 归属：SHIP_PLAN §2 第 10 项；Windows App 前端（`tono-ui/tono-layout.tsx`）。
- 来源：基线 `344aa3bb` → 分支 `fix/win-shortcut-connect-rejection-20261002`，PR #1351；尚未合入 main。
- 缺陷修复：用 Ctrl+K 连接被拒时，没有可用服务器就打开服务器列表，其余失败回到主页（进度卡显示失败记录）；被更新的操作取代不算失败。原先拒绝被直接丢掉，按键像失灵。
  关联 WIN-SHORTCUT-CONNECT-DEAD-KEY。
- 新增/优化：无。主页按钮和托盘的连接不变。
- 工程与测试修正：回归 `opens the server picker when Ctrl+K connect is refused for no server` 先单独推送为 `96d0a0a4`（红），结果记在 PR。
- 验证：仅托管 CI（vitest）；未在 Windows 实机上复现。仅源码，无新候选。
