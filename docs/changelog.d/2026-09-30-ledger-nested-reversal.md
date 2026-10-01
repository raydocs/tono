## 2026-09-30 · CSV totals follow repeated ledger reversals
- 归属：ops plan §1.3 / control-plane ledger export correctness.
- 来源：origin/main `a28b99bd` → `hunt/sol-r4cp-nested-reversal`; this PR source, not yet merged.
- 缺陷修复：Undoing a reversal exported the source amount with the first reversal's sign. Use the CNY effect's polarity; when FX rounded it to zero, follow immutable ancestors across months. R4CP-LEDGER-NESTED-REVERSAL, verified sibling missed by #767.
- 新增/优化：None; schema, DTOs, CSV columns, single reversals and stored accounting are unchanged.
- 工程与测试：Two narrow Worker/D1 regressions cover ordinary repeated reversal and a zero-rounded legacy UUID chain whose ancestors are outside the exported month.
- 验证：Linux / Node24; both tests failed before the fix; ledger suite 28 passed, typecheck and ops budgets passed. Full baseline control-plane suite passed 46 files / 974 tests before this delivery.
- 候选/发布：Source only, no new package, deployment or publication.
- 剩余限制：Zero-rounded nonzero reversals require one additional indexed ancestry query. Public APIs preserve acyclic immutable ancestry; this does not repair administrator-corrupted ledger links.

2026-09-30 continuation: rebased onto `259daecb` after #1091 merged; preserved all three new ledger regressions. Rebased ledger suite 29 passed and typecheck passed; the initial 28-test receipt above remains the pre-rebase result.
