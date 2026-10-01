## 2026-10-01 · Windows durable selective release
- Ownership: SHIP_PLAN §2 item 10; Windows automatic recovery.
- Source: baseline `afd58db1`; branch `hunt/sol-r4fwa-ai-hold`, source PR only, not yet merged.
- Defect fix: automatic release now persists its secondary AI disposition before detached installation. Startup and cleanup retries replay only that narrow layer after general WFP/DNS cleanup. Idle SCM Stop, replacement, and automatic emergency update cleanup preserve the record; explicit Restore supersedes it. Legacy reconnect records retain their automatic meaning.
- New/optimization: none; ordinary internet release and explicit strict admission are preserved.
- Engineering/tests: seven narrow production-facade regressions model process interruption and record preservation; one existing retry regression now checks replay.
- Verification: Linux Rust, `CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/windows/service/Cargo.toml --locked --features standalone,client,test --lib core::windows_kill_switch::tests::`: original source with new tests 113 passed / 7 failed; fixed source 120 passed / 0 failed. `git diff --check` passed. Existing unrelated warnings remain.
- Candidate/publication: source only; no new candidate, package, signing, deployment or publication.
- Limits: native Windows WFP/NRPT/SCM and installed crash/replacement acceptance require CI and hardware. Existing native failure, orphan-child and simultaneous persistence-failure limits remain.
