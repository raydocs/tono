## 2026-09-30 · Windows committed DIRECT expiry retires Core before fallback
- 归属：SHIP_PLAN §2 item 10; Windows Service automatic recovery.
- 来源：baseline `7f382af7`; branch `hunt/sol-r4ks-watchdog-core-retirement`; PR pending, source only.
- 缺陷修复：App heartbeat loss left Service-owned Core and its TUN/strict-route policy alive after Tono WFP release. Committed expiry now uses the existing fenced lifecycle retirement before selective fallback.
- 新增/优化：无; strict mode and incomplete DIRECT phases preserve existing policy.
- 工程与测试：one production-watchdog regression; existing expiry tests explicitly drive the lifecycle retirement step and retain their strict/retry/AI assertions.
- 验证：Linux Rust 1.98.1; regression failed before; WFP tests 112 passed, manager tests 6 passed with `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib <module>`; `git diff --check` passed. Native Windows networking unrun.
- 候选/发布：仅源码，无新候选; no deploy or publish.
- 剩余限制：needs-hardware; existing disk/native cleanup failures and best-effort AI-layer boundaries remain. Generic unhealthy-WFP release is outside this committed-expiry change.
