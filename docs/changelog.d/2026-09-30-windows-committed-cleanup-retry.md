## 2026-09-30 · Windows committed update cleanup remains retryable
- Ownership: SHIP_PLAN §2 item 10; Windows native update executor.
- Source: baseline `ad53abb6`; branch `hunt/sol-r3svc-committed-cleanup-retry`; not yet merged.
- Bug fix: a transient artifact deletion failure after commit now keeps the SYSTEM ONSTART recovery task, so old rollback bytes can be removed on a later boot instead of poisoning a subsequent update. Finding `WIN-COMMITTED-CLEANUP-RETRY` (P2).
- New features: none; manual installer cleanup, pending recovery and protection policy are unchanged.
- Engineering/tests: one Windows regression holds the real rollback file without delete sharing, checks cleanup failure before retirement, then checks a successful idempotent retry after closing the handle.
- Verification: Linux Rust 1.98.1; `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --bin tono-service-install`: 17 portable tests passed. These exclude the Windows executor regression. Rustfmt parsed the changed module; `git diff --check` passed. Independent read-only review found no blockers.
- Candidate/release: source only; no new package, deployment or publication.
- Limits: Windows-only regression and native update behavior are not runnable on this Linux host; CI must qualify them. Retry occurs at a later boot, not immediately.
