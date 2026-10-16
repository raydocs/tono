## 2026-10-12 · 停用 jev-route：删去 AGENTS.md 的 Jev 条款与 `.jev-route.json`
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)（代理流程维护；不是 ship gate）。
- 缺陷修复：无。
- 新增/优化：无产品行为变化。
- 工程与测试修正：所有者 2026-10-12 停用 jev-route（维护机上的 skill 与 hook 已卸）。AGENTS.md 删去「Jev 可选」的两处条款，
  SHIP_PLAN §4 与 BUILD_AND_TEST 删去 jev-route 提及，删除 `.jev-route.json`。高风险 diff 仍按 AGENTS.md 由 Codex high 独立审查，
  停止规则与合并条件不变。决策 [096](../decisions/096-2026-10-12-retire-jev-route.md)。INTERNAL_CHANGELOG、FINDINGS_LEDGER、
  已有 changelog.d 条目与 agent-reports 里的 jev-route 历史记载不改。
- 验证：仅文档与配置；`git grep -n -i jev -- AGENTS.md docs/SHIP_PLAN.md docs/BUILD_AND_TEST.md` 无输出，`.jev-route.json` 已不存在。
- 候选/发布：仅源码，无新候选；不部署。
