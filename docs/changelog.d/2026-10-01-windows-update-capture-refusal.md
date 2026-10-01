## 2026-10-01 · Finalize refused Windows update token capture
- Ownership: SHIP_PLAN §2 item 10; Windows failed-update recovery.
- Source: baseline `6ba79f61`; branch `hunt/sol-r4fwa-capture-refusal`, source PR only, not yet merged.
- Defect fix: initiating-user token capture refusal is deferred to the existing stopped-Service selective failure finalizer. It skips consumption, registration, App termination and publication, while restoring ordinary internet with the AI hold and Service supervision unless explicit strict protection is present.
- New/optimization: none; unconsumed Staged retry/verified retirement and receipt/high-water semantics remain. Consume samples fresh time after capture.
- Engineering/tests: five narrow real-Store tests cover refusal, exact executor binding, one-time successful consumption, refusal-record failure and capture crossing receipt expiry.
- Verification: Linux Rust, `CARGO_BUILD_JOBS=2 cargo test --manifest-path apps/windows/service/Cargo.toml --locked --features standalone,client,test --lib update_transaction::tests::`: original capture propagation 0 passed / 1 failed; final Store suite 19 passed / 0 failed. `git diff --check` and targeted rustfmt syntax parsing passed. Existing unrelated warnings remain.
- Candidate/publication: source only; no package, signing, deployment or publication.
- Limits: Windows-only executor/token/SCM/WFP cannot execute here. Hosted Windows CI and installed token-capture refusal acceptance remain required; native cleanup failure or another interruption can still require recovery.
