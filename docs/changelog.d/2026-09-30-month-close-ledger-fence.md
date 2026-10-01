## 2026-09-30 · 关账校验账目快照
- 归属：ops plan §1.3；control-plane 月结账本。
- 来源：origin/main `5ba113d2` → `hunt/sol-cp-month-close-ledger-fence`，本 PR 源码；尚未合 main。
- 缺陷修复：关账读取后成功入账会被漏记 → 关账 INSERT 原子校验原账目 ID/归属快照，变更返回 409 并允许重试。关联 SOL-CP-LEDGER-CLOSE-RACE。
- 新增/优化：无；既有关账冲突、账目写入保护和快照大小上限保持。
- 工程与测试：新增一条真实 API 入账与关账之间的屏障回归；修复前失败，修复后通过。
- 验证：Linux / Node24；账本 24 测试、typecheck、ops budgets 通过；全量 npm test 结果记录在 PR。未执行部署或实机操作。
- 候选/发布：仅源码，无新候选。
- 剩余限制：不修复历史错误关账；活动和资产读取并非事务快照。
