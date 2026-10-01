## 2026-10-01 · Windows unarmed recovery survives its own Connect timeout
- 归属：SHIP_PLAN §2 item 10; Windows unattended recovery.
- 来源：origin/main bb54ff5c; hunt/sol-r4fws-timeout-owner; source PR, not yet merged.
- 缺陷修复：#1101, a transaction timeout after admission retires twice (G→G+1→G+2); the recovery loop now receives and adopts its exact reconciled failure generation and keeps the existing backoff instead of stopping unattended recovery.
- 新增/优化：无。Existing release/AI-hold/strict-mode disposition and public Connect error text are preserved.
- 工程与测试：one regression drives real admission, shared transaction expiration, timeout retirement and detached failure reconciliation before checking owner adoption/backoff and later user cancellation.
- 验证：Linux Rust 1.98.1 exact-source boundary fixture with real tono-core: before 0 passed / 1 failed (None vs Some(2)); after 1 passed / 0 failed. git diff --check and Rust syntax parsing passed. First fixture compile missed unused customer_failure dependencies; switched to the real tono-core dependency before behavioral execution. No product/CI change for that fixture correction.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：full Windows/Tauri build and installed WFP/DNS/sleep behavior require CI/hardware; portable core retains an unrelated unused constant warning.
