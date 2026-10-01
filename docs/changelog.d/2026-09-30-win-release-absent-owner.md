## 2026-09-30 · Stop an unrecorded Windows Core before Disconnect releases filters
- 归属：SHIP_PLAN §2 item 10; Windows Service owner-only Disconnect reliability.
- 来源：origin/main `50bbbbf0` → `hunt/sol-trust-release-absent-owner`; [#873](https://github.com/raydocs/tono/pull/873); source only.
- 缺陷修复：missing/corrupt active-owner record previously skipped teardown even with a supervised Core; after policy-owner admission the Service now stops Core and conditionally retires retained runnable desired state before disarming.
- 新增/优化：none; idle release does not create desired state, and readable other-owner records remain refused.
- 工程与测试：one narrow regression exercises the actual corrupt-record loader and desired-state retirement helper. It does not start a live process or execute the Windows-only router branch.
- 验证：Linux Rust 1.98.1, `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib core::server::owner_lifecycle_tests`: 11 passed. New regression failed before implementation because runnable desired state survived. `git diff --check` passed. Native WFP/DNS and installed Windows behavior not run.
- 候选/发布：source only; no new candidate/deployment/publication.
- 剩余限制：needs hardware. The separate narrow owner-goodbye/connect race is recorded open at P2. Existing failed-stop DNS compensation is covered separately by #866, not this ownership-record fix.
