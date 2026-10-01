## 2026-09-30 · Windows interrupted first-connection recovery keeps the AI hold
- Ownership: SHIP_PLAN §2 item 10; Windows Service startup recovery.
- Source: baseline `2a7d73d7`; branch `hunt/sol-r3svc-unverified-recovery-ai-hold`; not yet merged.
- Bug fix: after an ordinary Service crash during initial connection, automatic unverified retirement opens general traffic and applies the existing secondary AI hold. Explicit strict intent is excluded from automatic retirement.
- New features: none. Existing DNS/Core reconciliation and explicit Restore semantics remain.
- Engineering/tests: one narrow regression for the AI hold and one for strict intent; both failed before the fix on Linux.
- Verification: Rust 1.98.1, `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib unverified_startup_`: 3 passed, 0 failed. Native Windows and installed WFP/NRPT behavior not run here.
- Candidate/release: source only; no new package, deployment or publication.
- Limits: the existing narrow layer is best-effort with documented resolver/cache limits; cleanup failures are unchanged. Needs hardware.
