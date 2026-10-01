## 2026-09-26 · 审查停止规则（minor 不再无限轮修）

- 归属：ops（流程规则）；无代码改动。
- 来源：基线 origin/main `737089a0`；分支 `docs/review-stop-rule-20260926`。
- 新增/优化：AGENTS.md 合并条件 1 增加停止规则（所有者 2026-09-26 决定）：只有 major 及以上阻塞合并；minor 修一轮，
  之后仍未关闭的产品缺陷以 open 记入 `docs/findings.d/`，总账不收的工程/测试/文档项写进 PR 正文的剩余限制，然后合并。放松 PF/WFP fail-closed、泄漏、越权、跨账户串扰、保护已解除却显示已保护（总账「高」影响）至少按 major 计。
- 原因：#642（10 轮）、#643、jev-route 0.6.1（8 轮）在并发/状态代码上每轮都出现新的 minor，原规则没有收敛条件。
- 验证：无（仅文档）；jev-route dual_cross_family 审查 run 621a4fbb。
- 候选/发布：无新包。
- 剩余限制：jev-route 的 blocker/major/minor 与总账 高/中/低 只规定了上面这条下限，其他对应仍由审查者判断。
