## 2026-09-30 · Windows Quit bounds optional idle-Service shutdown
- 归属：SHIP_PLAN §2 item 10；Windows App quit lifecycle.
- 来源：`origin/main` 2bfa95d1；分支 `hunt/sol-r3acct-idle-quit-budget`；PR pending, not yet merged.
- 缺陷修复：one unresponsive optional Service status/goodbye IPC no longer delays an already-approved Quit for its long transport deadline; the combined optional wait returns after two seconds and logs the timeout. Finding WIN-IDLE-QUIT-IPC-DELAY.
- 新增/优化：无；required network release and Core cleanup remain awaited under their existing rules.
- 工程与测试：one paused-clock regression exercises the exact production wait helper with unanswered and immediately completed optional work.
- 验证：Linux Rust 1.98.1, CARGO_BUILD_JOBS=2; exact-function/test portable harness failed before (0 passed, 1 failed) and passed after (1 passed, 0 failed); `git diff --check` passed. Native Windows App compilation/test and installed quit/SCM behavior not runnable locally.
- 候选/发布：仅源码，无新候选；no deploy or publish.
- 剩余限制：an already-dispatched Service request may finish after App timeout, subject to its unchanged server-side gates; needs-hardware.
