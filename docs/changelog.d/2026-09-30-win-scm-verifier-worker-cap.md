## 2026-09-30 · Cap surviving Windows SCM verifier workers
- 归属：SHIP_PLAN §2 item 10; Windows IPC client reliability.
- 来源：origin/main `560af1ac` → branch `hunt/sol-trust-scm-verifier-worker-cap`; [#933](https://github.com/raydocs/tono/pull/933); source only.
- 缺陷修复：a prolonged SCM stall outlived each request deadline while recurring monitors spawned more OS verifier threads; an eight-worker process-wide budget now stays owned until each detached query really finishes.
- 新增/优化：none; exhausted capacity returns the existing unproven identity result, preserving all identity/protection checks and request deadlines.
- 工程与测试：one channel-gated regression verifies timeout retention, rejection without starting work, and reuse after completion.
- 验证：Linux Rust 1.98.1, `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib client::retry_safety_tests`: before new regression failed (`Some(9)` instead of `None`); after suite 10 passed. `git diff --check` passed. Existing Linux cfg warnings retained. Actual Windows identity calls unavailable here; hosted CI and hardware remain required.
- 候选/发布：only source; no new package, deployment or publication.
- 剩余限制：a permanently wedged OS query still occupies one slot; subsequent identity checks refuse safely. No actual thread-exhaustion incident or machine crash claimed. No WFP/DNS/routes/AI/strict policy change.
