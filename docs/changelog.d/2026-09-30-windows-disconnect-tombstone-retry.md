## 2026-09-30 · Windows Disconnect supersedes crash-record retry
- 归属：SHIP_PLAN §2 item 10; Windows durable connection intent.
- 来源：`9d5735e6` → branch `hunt/sol-r3ks1-disconnect-tombstone-retry`; this PR, not yet merged.
- 缺陷修复：After a transient crash-tombstone write failure, a later successful Disconnect could be overwritten by the watchdog's pending reconnect record. Successful release now cancels the predecessor retry so recovering Service honors the user's Disconnect.
- 新增/优化：无; no change to filters, DNS, normal AI blocking, strict behavior or selective-layer disposition.
- 工程与测试：One narrow production-method regression covers failed crash write → successful release → watchdog retry → Service recovery.
- 验证：Linux Rust 1.98.1, regression first failed on stale reconnect intent; `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib core::windows_kill_switch::tests -- --test-threads=1`: 95 passed, 0 failed. `git diff --check` passed. Windows build/networking not run here.
- 候选/发布：仅源码，无新候选；no deploy or publication.
- 剩余限制：P2 requires crash recovery plus a write failure; in-memory reconnect does not change until later Service recovery. Native TUN/WFP/DNS remains needs-hardware.
