## 2026-09-30 · Windows Restore no longer waits for a stalled optional DIRECT reload
- 归属：SHIP_PLAN §2 item 10; Windows app network recovery.
- 来源：origin/main `6dc5b90d` → branch `hunt/sol-winapp-direct-restore-cancellation`; source PR only, not yet merged at authoring.
- 缺陷修复：WIN-DIRECT-RESTORE-WRITER-DELAY (P1): a controller reload that never answers held the lifecycle reader for two 60-second attempts; explicit Restore could time out before Service teardown started. The retired connection now cancels controller waits, while detached exact-session reconciliation still completes before release admission.
- 新增/优化：无; Service mutations, strict protection and AI routing rules remain unchanged.
- 工程与测试：one localhost stalled `/configs` regression also verifies the writer waits for retraction; no CI gates changed.
- 验证：Linux Rust 1.98.1, extracted production controller/reload/cancellation code and checked-in test with a reduced lifecycle state fixture: before 0 passed/1 failed after 5 seconds, after 1 passed in 0.04 seconds. `git diff --check` passed. Full Tauri/Windows tests not runnable here; hosted Windows CI required.
- 候选/发布：仅源码，无新候选，无部署/发布。
- 剩余限制：real-machine Core hang, DNS restore and WFP removal need hardware validation; cancellation cannot make an independently wedged Service respond.
