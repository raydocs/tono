## 2026-10-01 · Replay Windows rollback finalization
- Ownership: SHIP_PLAN §2 item 10; Windows failed-update recovery.
- Source: baseline `ad8ab2cd`; branch `hunt/sol-r4fwa-rollback-finalize`, source PR only, not yet merged.
- Defect fix: interrupted RolledBack updates now replay only selective network cleanup and Service supervision/readiness. Two attempt-bound durable stages avoid another stop/release once the network is settled and avoid repeated startup recovery once Service is ready.
- New/optimization: none. No forward publication/consume authority, receipt phase, required recovery or high-water is changed. Strict protection and verified explicit Restore retain their disposition.
- Engineering/tests: production portable finalizer tests cover interruption, strict hold, explicit Restore, foreign marker, both marker-write failures and Service restoration ordering. Shared startup/executor gate uses that durable evidence.
- Verification: Linux Rust, `CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/windows/service/Cargo.toml --locked --features standalone,client,test --lib update_transaction::tests::`: decisive admission regression 0 passed / 1 failed before, complete Store suite 20 passed after. An initial test fixture used a time before its authorized receipt; corrected before the decisive run. `git diff --check` and targeted rustfmt syntax parsing passed.
- Candidate/publication: source only; no new package, signing, deployment or publication.
- Limits: Windows-only executor/SCM/WFP cannot run here; hosted CI and installed interruption acceptance remain required. Durable record failure cannot replace a successful Service restoration with failed-restart cleanup.
