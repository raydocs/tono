## 2026-09-30 · Windows Prepare preserves prior committed backup recovery
- Ownership: SHIP_PLAN §2 item 10; Windows native update preparation.
- Source: baseline `46ba1ffc`; branch `hunt/sol-r3svc-prior-commit-cleanup`; not yet merged.
- Bug fix: before replacing a committed journal entry, Prepare cleans retained external backup scratch with the existing all-member proof. Failed cleanup preserves the original attempt/task instead of stranding its reboot retry. Finding `WIN-PREPARE-COMMITTED-BACKUPS` (P2), follow-up to #1017.
- New features: none; strict/network policy, manual replacement without scratch, and installed-version metadata remain unchanged.
- Engineering/tests: three narrow Windows regressions cover a real backup sharing lock with durable-state retention and retry, manual replacement after scratch removal, and an unproven installed target with retained backup.
- Verification: Linux Rust 1.98.1; `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib update_transaction::tests::`: 14 passed. These portable journal tests exclude the new Windows coordinator tests. Rustfmt parsed the changed module; `git diff --check` passed. Independent read-only review found no blockers.
- Candidate/release: source only; no new package, deployment or publication.
- Limits: native Windows regressions are not runnable on this Linux host; CI must qualify them. Missing/unreadable prior plans refuse early; ARP-version retry is outside this retained-backup fix.
