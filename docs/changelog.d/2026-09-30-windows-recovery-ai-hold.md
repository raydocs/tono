## 2026-09-30 · Windows recovery keeps the secondary AI hold
- 归属：SHIP_PLAN §2 item 10；Windows Service WFP recovery.
- 来源：origin/main `c8b6aab4` → `hunt/sol-r3ks-recovery-ai-hold`; source fix awaiting CI/merge.
- 缺陷修复：corrupt/unreadable/unusable-state and unhealthy-watchdog recovery, plus the unproven-Core recovery added by #740, opened general traffic without applying the existing narrow AI layer. Both release helpers now apply it after removing WFP. Finding: WIN-RECOVERY-AI-HOLD-OMISSION.
- 新增/优化：无；no new filter shape, suffix, prefix, or strict-mode decision.
- 工程与测试：the non-native selective-layer backend records its active state for the existing recovery regressions.
- 验证：Linux Rust 1.98.1; both added recovery assertions failed before the fix. `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib core::windows_kill_switch::tests::`: `86 passed; 0 failed`; `git diff --check` passed. Existing unrelated compiler warnings remain.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：Windows production FFI and real WFP/NRPT/DNS were not run here; hosted Windows CI and needs-hardware acceptance remain. The existing AI layer is best-effort and cannot guarantee coverage of cached/DoH/literal-IP traffic.
