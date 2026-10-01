## 2026-10-01 · Windows complete-publication recovery fences App adoption

- 归属：G3；Windows native update executor and transaction store.
- 来源：baseline `fafa1bc0` → branch `hunt/sol-r4fwa-recovery-clock`; PR pending; source delivery, not yet merged at writing.
- 缺陷修复：#1055 row `R3REGW-RECOVERY-PUBLICATION-FLOOR`; complete-publication recovery now saves a missing publication clock before Replaced, so an older mapped App cannot adopt solely because its on-disk path has the target hash.
- 新增/优化：none. Recovery retains the first durable floor and keeps an already published Service running. Strict and selective AI-blocking dispositions are unchanged.
- 工程与测试：one portable regression covers interrupted publication recovery, store reopen, rejection of an older incarnation, idempotent floor preservation, and adoption by a fresh incarnation.
- 验证：Linux portable regression failed before the fix (0 passed / 1 failed); `CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/windows/service/Cargo.toml --locked --features standalone,client,test --lib update_transaction::tests::` passed all 15 tests. Native Windows executor/process tests cannot run on this Linux host; CI and hardware checks remain pending.
- 候选/发布：仅源码，无新候选；no build, deployment, signing or publishing performed.
- 剩余限制：no native reproduction of the narrow pre-singleton process timing; other #1055 rows are not fixed by this patch.
