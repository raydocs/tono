## 2026-09-30 · Windows automatic Service stop keeps the AI hold
- Ownership: SHIP_PLAN §2 item 10; Windows Service Stop/Preshutdown recovery.
- Source: baseline `1fb29265`; branch `hunt/sol-r3svc-service-stop-ai-hold`; not yet merged.
- Bug fix: automatic armed non-strict Stop releases general traffic with the existing AI hold; idle Stop preserves an earlier crash hold or explicit Restore's absent hold. Strict protection remains armed.
- New features: none. Existing update/installer admission and DNS/Core/owner cleanup order stay intact.
- Engineering/tests: four narrow regressions for armed stop, idle-after-Restore, existing idle crash hold and strict protection. Baseline forwarding to plain release: 1 passed, 3 failed; fixed: 4 passed.
- Verification: Linux Rust 1.98.1 with CARGO_BUILD_JOBS=2; `cargo test --locked --features standalone,client,test --lib core::windows_kill_switch::tests`: 96 passed, 0 failed. `git diff --check` passed. Native Windows/SCM behavior unrun locally.
- Candidate/release: source only; no new package, deployment or publication.
- Limits: existing selective layer is best-effort and cleanup can still fail; real-device Stop/reboot/DNS/WFP validation required.
