## 2026-09-30 · Reserve accepted Windows owner shutdown before response grace
- 归属：SHIP_PLAN §2 item 10; Windows Service lifecycle reliability.
- 来源：origin/main `b341164b` (includes #873/#792) → branch `hunt/sol-trust-goodbye-admission`; PR pending; source only.
- 缺陷修复：accepted idle goodbye left new mutations admissible during its 250 ms response grace; shutdown is now reserved under the owner lifecycle lock, and both ordinary lifecycle/update mutations reject before starting.
- 新增/优化：none; response grace and existing armed/strict/desired-state refusal retained. Reservation persists across listener restart but does not block teardown itself.
- 工程与测试：one actual lifecycle-admission regression, with serial/RAII cleanup and no timing sleep/race.
- 验证：Linux Rust 1.98.1, `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib core::server::owner_`: new regression failed before (work admitted); after 16 passed. `git diff --check` passed. First test setup used unsupported paused-time API, corrected without changing Cargo features/gates. Actual Windows routes/WFP/DNS/SCM unavailable here; hosted CI and hardware required.
- 候选/发布：only source; no new package, deployment or publication.
- 剩余限制：P2 short concurrent request window; no proven machine crash or real-device outage. No change to strict/AI/firewall/DNS policy.
