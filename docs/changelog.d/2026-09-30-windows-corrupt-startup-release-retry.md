## 2026-09-30 · Windows retries failed ownerless startup release
- 归属：SHIP_PLAN §2 item 10; Windows Service startup/WFP recovery.
- 来源：`262b1864` baseline; rebased onto `72a9c98d` → branch `hunt/sol-r3ks1-corrupt-release-retry`; this PR, not yet merged.
- 缺陷修复：Unusable non-strict startup evidence plus transient WFP removal failure left persistent filters without a watchdog owner. The existing backoff worker now retries this release, preserves evidence and retains the secondary AI hold.
- 新增/优化：无; explicit strict and newer session evidence end the retry; wanted:false reconnect/AI semantics unchanged.
- 工程与测试：One failing-then-passing recovery regression and one narrow strict-successor guard regression; no CI changes.
- 验证：Linux Rust 1.98.1, baseline recovery test failed at eventual removal. `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib core::windows_kill_switch::tests -- --test-threads=1`: 104 passed, 0 failed (final rebased tree; initial fixed tree had 100 passed). `git diff --check` passed. Native Windows build/networking not run here.
- 候选/发布：仅源码，无新候选；no deploy or publication.
- 剩余限制：P2 needs two independent failures. A transiently unreadable record that becomes readable valid wanted intent still ends the retry without ARMED; conservative wanted admission is unchanged. Persistent native engine failure remains an external limitation; WFP/DNS remains needs-hardware.
