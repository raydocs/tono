## 2026-09-30 · Windows native rollback releases ordinary traffic
- 归属：SHIP_PLAN §2 item 10；Windows native update executor, finding WIN-UPDATE-ROLLBACK-UNVERIFIED-HOLD.
- 来源：baseline `4ef4bf74` → branch `hunt/sol-r3inst-rollback-release` (this PR); not yet merged when authored.
- 缺陷修复：a native publication failure after an unverified connection restored old binaries and restarted Service but retained the full update barrier; durably rolled-back non-strict attempts now use the existing AI-preserving emergency release before restarting Service.
- 新增/优化：none; strict blocking, successful-update protection, pending receipt, consumed sequence and recovery copies remain intact. Rolled-back attempts do not wait for an impossible successor commit.
- 工程与测试：one narrow regression of production release/restart disposition, including strict/success guards and restart after cleanup error.
- 验证：Linux Rust 1.98.1 exact-source portable harness: before 0 passed/1 failed, after 1 passed/0 failed; `git diff --check` passed. Native Windows compilation and installed SCM/WFP/NRPT fault injection not runnable here; await CI and hardware.
- 候选/发布：source only; no candidate, deployment or publication.
- 剩余限制：existing emergency cleanup can still fail; existing selective AI-layer DNS/cache/non-system-resolver limitations remain. No installed-device acceptance claimed.
