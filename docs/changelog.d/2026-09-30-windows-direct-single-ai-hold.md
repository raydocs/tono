## 2026-09-30 · Windows DIRECT expiry keeps its first AI hold
- 归属：SHIP_PLAN §2 item 10；Windows Service automatic DIRECT lease expiry.
- 来源：origin/main `0650bb52` → branch `hunt/sol-r3regw-direct-single-ai-hold`, [#1044](https://github.com/raydocs/tono/pull/1044); source fix awaiting CI/merge.
- 缺陷修复：the combination of #777 and #974 installed the secondary AI hold twice. The second reconciliation removed an already-active hold while ordinary traffic was open. Delete the redundant application. Finding: R3REGW-DIRECT-DOUBLE-HOLD (P2 transient exposure).
- 新增/优化：无；strict mode and in-flight DIRECT retraction retain their existing protection.
- 工程与测试：a test-only counter observes active-hold removals in the existing portable native facade; one actual committed-expiry regression checks the intermediate safety property as well as final release/hold.
- 验证：Linux Rust 1.98.1, CARGO_BUILD_JOBS=2. New regression failed before the production fix (one active hold removed, expected zero). `cargo test --locked -p tono-service-protocol --features standalone,client,test --lib core::windows_kill_switch::tests -- --test-threads=1`: 108 passed; focused `core::selective_layer::tests`: 2 passed. `git diff --check` and independent read-only ordering/strict/test review passed.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：native Windows WFP/firewall/NRPT acceptance cannot run in this Linux VM; CI and needs-hardware acceptance remain. The existing secondary hold remains best-effort with its existing coverage limits.
