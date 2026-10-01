## 2026-09-30 · Windows catalog recovery retains the secondary AI hold
- 归属：SHIP_PLAN §2 item 10；Windows catalog sync/recovery.
- 来源：`origin/main` 0b1521be；分支 `hunt/sol-r3acct-catalog-ai-hold`；PR pending, not yet merged.
- 缺陷修复：automatic catalog removal of the selected exit now dispatches the existing narrow release, restoring ordinary internet and retaining the secondary AI hold. Strict-mode teardown and explicit user Restore behavior stay intact. Finding WIN-CATALOG-VANISH-AI-HOLD.
- 新增/优化：无。
- 工程与测试：one regression exercises the production release dispatch and lifecycle-writer transfer.
- 验证：Linux Rust 1.98.1, CARGO_BUILD_JOBS=2; exact production-function/test portable harness failed before (0 passed, 1 failed) and passed after (1 passed, 0 failed). `git diff --check` passed. Windows App compilation/native tests and installed WFP/NRPT behavior not run locally.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：needs-hardware; existing selective-layer DNS, DoH and cached-address limitations remain.
