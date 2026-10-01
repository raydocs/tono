## 2026-09-30 · Preserve a ledger entry when close wins its reversal race
- 归属：ops plan §1.3 / ledger correctness.
- 来源：origin/main 50bbbbf0 → hunt/sol-cp-reversal-close-guard; PR pending, not merged.
- 缺陷修复：Close after reversal preflight caused zero INSERTs but still marked the original reversed; now mark only when the immediately preceding reversal INSERT succeeds.
- 新增/优化：无; closed-month and single-reversal rules preserved.
- 工程与测试：One barrier regression closes the month just before the reversal batch, then checks MONTH_CLOSED and an untouched original/no reversal row.
- 验证：Node24/Linux: regression failed before fix (dangling reversed_by), ledger suite 24 passed and typecheck passed; full suite 44 files / 950 passed.
- 候选/发布：仅源码，无新候选; no deployment/publication.
- 剩余限制：Does not repair historical corrupted reversal pointers; no production database mutation.
