## 2026-09-30 · Freeze reconciliation when closing a month
- 归属：ops plan §1.3 / month-end accounting.
- 来源：origin/main 50bbbbf0 → hunt/sol-cp-month-reconciliation-snapshot; PR pending, not merged.
- 缺陷修复：Closed-month bill reconciliation changed when inventory was later retired/reassigned/repriced; include reconciliation in the saved summary so new closed reports preserve it.
- 新增/优化：无; existing snapshot size cap and partial fallback remain.
- 工程与测试：One regression closes a month, retires a priced node, and verifies its frozen reconciliation and unreconciled bill count.
- 验证：Node24/Linux; regression failed before fix (missing bill disappears); ledger suite 24 passed; typecheck passed; full suite 44 files / 950 tests passed.
- 候选/发布：仅源码，无新候选; no deployment/publication.
- 剩余限制：Existing closed snapshots are not rewritten; oversized partial snapshots and legacy snapshots lack frozen reconciliation.
