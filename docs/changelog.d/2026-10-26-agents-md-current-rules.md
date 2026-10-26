## 2026-10-26 · AGENTS.md：去掉写死的版本号，暂停独立 review，补分支清理规则
- 归属：工程流程；不是客户发布门。仅文档，无新候选。
- 来源：基线 `origin/main` `88a8f2561` → 分支 `docs/agents-md-current-rules-20261026`；未合 main。
- 缺陷修复：AGENTS.md 写死「customer 0.0.75」和「仅 0.0.75：G1、G2」，源码已到 0.0.80，agent 会把旧版本当成这一发。改为从 SHIP_PLAN 与 RELEASE_LINES 读当前版本，本文件不写版本号。
- 新增/优化：
  - 新增 `## Review policy`：老板 2026-10-26 决定暂停合并/部署前的独立 review（[决策 136](../decisions/136-2026-10-26-review-paused.md)），高风险改动也不再等 review；ci-gate、窄回归、验证评论、UI/真机不开 auto-merge 和发布门不变。
  - 分支清理：除脚本删的已合并分支外，已关闭/已合并 PR 的分支、没有 PR 的 RED 证据分支和废弃实验分支也直接删，不备份；open PR 能合就合。
- 工程与测试：同日按此规则清理了远端分支（150 → 35）、本地分支和已合并 worktree。
- 验证：仅文档，未跑产品测试。
- 候选/发布：无新包，不部署。
