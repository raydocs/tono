## 2026-10-28 · ops console：节点页整页截图前回到页顶
- 归属：ops 计划（运维控制台回归测试），不属发布门；`services/ops-console/e2e/nodes.spec.ts`。
- 来源：`main` 4e24e50a7 → 分支 `fix/ops-nodes-dashboard-capture-scroll`；Refs #1805。
- 缺陷修复：无产品缺陷。
- 工程与测试：Screenshots nightly run 40594549832（`71a007eea`）的 `nodes page › dashboard` 差 14959 像素（1%）：筛选按钮点击把页面滚到 484 px 并把指针留在表格行上，整页截图因此把固定侧栏画在滚动位置、并带一行悬停底色，而基线是页顶、无悬停。截图前把指针移开、滚回页顶并等一帧。
- 验证：见 PR 验证评论（像素比对只在 macOS nightly 跑）。
- 候选/发布：仅测试，无新候选。
- 剩余限制：页面说明行「本页截至 · 正在回填」的间距与基线有低于阈值的差异，本次未处理。
