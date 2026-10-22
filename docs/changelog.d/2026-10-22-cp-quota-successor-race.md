## 2026-10-22 · 节点配额 successor 并发采样不再重复计量
- 归属：`docs/ops/plan-2026-09-11.md` §1 节点配额 / cron `quota` 的正确性维护，遵守 §2；仅 control-plane 运维节点计量，不属于桌面 SHIP_PLAN 发布冻结。
- 来源：`d1232520a742b3e747f7b9a228361d696f24a172` → 本 PR 分支 `t3/fix-quota-successor-race`；未合 main。开工时已核对最新 main 与现有 PR，无重复修复。
- 缺陷修复：`CP-QUOTA-SUCCESSOR-RACE` 已由本地 D1 确定性并发回归确认。创建者回读 successor 时可能拿到另一采样的新状态，把旧样本误算 reset；现改为 INSERT `RETURNING` 快照，让原有 CAS 拒绝已被超越的样本。真实 reset、严格额度、跨界归属和节点隔离不变。
- 新增/优化：无；不改 catalog、客户计费、账号、凭证或任何放行保护，不加迁移。
- 工程与测试：一个行为、一个 `it`；真实 Workers/D1 和生产迁移，屏障只暂停已提交批事务的返回，不串行 mock SQL。另检查其他节点及旧周期不受影响。
- 验证：MacBook 本工作树；旧代码定向回归 RED：`expected { used: 250, last: 150, resets: 1 } to deeply equal { used: 100, last: 200, resets: +0 }`。改后同条 GREEN：`1 passed | 13 skipped (14)`；完整 `vitest run test/ops-quota.test.ts`：`14 passed (14)`；额外定向重复 5 次均通过。`npm run typecheck && npm run check:contract && npm run check:budgets` exit 0。原始日志和交错说明见 [finding](../findings.d/CP-QUOTA-SUCCESSOR-RACE.md)。
- 候选/发布：仅源码，无新候选；未部署、未合并、未启用 auto-merge。
- 剩余限制：完整 Worker 套件/覆盖率、CI、远端 D1 和生产节点未运行；不声称已发生生产事故或覆盖所有 rollover 竞争。计量/并发高风险独立审查待父线程完成，draft PR 不可据此合并或部署。
