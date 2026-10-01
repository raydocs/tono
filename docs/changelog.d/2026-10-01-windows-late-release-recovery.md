## 2026-10-01 · Windows automatic recovery awaits successful late release
- 归属：SHIP_PLAN §2 item 10; Windows connection lifecycle.
- 来源：origin/main 6ba79f61; hunt/sol-r4fws-late-release-recovery; source PR not yet merged.
- 缺陷修复：automatic health cleanup formerly treated the 55-second explicit UI budget as a failed release, losing recovery when native cleanup succeeded a second later. Automatic narrow cleanup now awaits the actual supervised result and can continue its unarmed recovery.
- 新增/优化：无。Explicit Disconnect/Restore UI waits, native timeout budgets, AI retention and strict mode are unchanged.
- 工程与测试：one paused-clock regression using the real release coordinator, operation and portable FSM; the native sequence is injected. No dependency/CI changes.
- 验证：Linux Rust 1.98.1 exact-source boundary fixture: before 0 passed / 1 failed at the UI deadline; after 5 release ownership tests passed. git diff --check and targeted rustfmt syntax parsing passed. Windows/Tauri/WFP/DNS execution unrun locally.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：needs-hardware. A native release failure still fails; this change only preserves recovery after actual successful cleanup. Separate stalled DIRECT writer and late StartClash AI disposition findings remain outside this fix.
