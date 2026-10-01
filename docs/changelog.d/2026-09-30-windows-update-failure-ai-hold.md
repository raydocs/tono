## 2026-09-30 · Windows failed updates keep the AI hold
- 归属：SHIP_PLAN §2 item 10；Windows native update recovery and emergency WFP release.
- 来源：origin/main `f8e32e00` → `hunt/sol-r3ks-update-ai-hold`; awaiting CI/merge.
- 缺陷修复：the automatic non-strict failed-restart cleanup added by #858 used explicit Restore semantics and removed the AI layer. It now selects a shared emergency-release variant that applies the existing narrow hold after successful WFP removal. Finding: WIN-UPDATE-FAILURE-AI-HOLD.
- 新增/优化：no destination/filter changes; explicit Restore/uninstall and strict-mode checks are preserved.
- 工程与测试：one failed-update emergency regression; test-only state backend and serialization match #974/#976.
- 验证：Linux Rust 1.98.1; regression failed before at the missing AI hold. `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib core::windows_kill_switch::tests::`: `87 passed; 0 failed`; `git diff --check` passed. Existing warnings remain.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：the Windows-only executor/SCM path and production WFP/NRPT/DNS were not run here. Hosted Windows CI and needs-hardware acceptance remain; existing tombstone and DNS recovery failure limitations are unchanged.
