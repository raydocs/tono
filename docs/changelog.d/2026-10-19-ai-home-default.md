## 2026-10-19 · macOS App：未选择过模式时默认 AI 家宽（草稿，实机测试后合并）
- 归属：G2 macOS App（路由模式默认值）；`apps/macos/Tono`、`AGENTS.md`。无辅助程序源码改动。
- 来源：`origin/main`（含 #1693、#1694）→ 分支 `feat/ai-home-default`；未合 main。决定见 [131](../decisions/131-2026-10-19-desktop-ai-home-default.md)。
- 新增/优化：
  - 从未保存过路由模式的设备默认 AI 家宽；账号没有家宽线路时，本次会话以稳定模式连接
    （`DesktopRoutingModeAdmission.effective`）。已保存的选择保持不变。回退只用于新会话：已在进行的会话
    （重启 App 后恢复、自动重连）保留原模式，即使目录尚未加载出家宽线路（`admit`）。
  - 设置页说明改为「默认使用 AI 家宽模式；账号没有家宽线路时以稳定模式连接」；无家宽时不停用局域网开关。
  - `AGENTS.md` 不变量改为按模式说明保护范围：稳定与三层是整机，AI 家宽只保护 AI 流量。
- 缺陷修复：无。
- 工程与测试：`AIHomeRoutingModeTests` 增加默认值与无家宽回退；`RuntimeConfigTests` 默认值断言更新。
- 验证：见 PR 验证评论。合并前须完成决定 131 列出的实机测试。
- 候选/发布：仅源码，草稿。
