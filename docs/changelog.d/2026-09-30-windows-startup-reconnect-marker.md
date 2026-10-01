## 2026-09-30 · Windows startup retry preserves crash reconnect intent
- 归属：SHIP_PLAN §2 item 10；Windows Service WFP recovery.
- 来源：origin/main `72f9862c` → `6a6e667d`, `hunt/sol-r3ks-startup-reconnect-marker`; PR pending, not merged.
- 缺陷修复：after crash recovery wrote a reconnect tombstone, a transient startup filter-removal failure sent it to a retry that deleted the record and never published its reconnect flag. Successful retry now retains and publishes the same crash intent as normal startup. Finding: WIN-STARTUP-RETRY-RECONNECT.
- 新增/优化：无；explicit Disconnect tombstones are still consumed; new wanted sessions still stop stale cleanup.
- 工程与测试：one regression using the existing simulated WFP removal failure.
- 验证：Linux Rust 1.98.1; `startup_release_retry_preserves_the_crash_reconnect_marker` failed before the fix. `CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib core::windows_kill_switch::tests::`: `87 passed; 0 failed`. `git diff --check` passed. Existing compiler warnings remain. A Rust 2024 formatting check reports existing file-wide drift; no broad formatting edits were made.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：native WFP/NRPT and device behavior were not runnable here; hosted Windows CI and needs-hardware acceptance remain. An app that sampled before retry completion can still need relaunch or manual Connect.
