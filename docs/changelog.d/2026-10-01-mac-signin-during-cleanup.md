## 2026-10-01 · macOS sign-in controls wait for account cleanup
- 归属：SHIP_PLAN §2 item 10; macOS app sign-in screen.
- 来源：origin/main `8f1b720b` → branch `fix/mac-1256-signin-during-cleanup`; Fixes #1256.
- 缺陷修复：A sign-in tapped while sign-out or Restore internet cleanup was still running was dropped by the account cleanup barrier with no feedback → `AccountLifecycleCoordinator` is now `@Observable` and exposes `isCleaningUp`; `LoginView` disables its sign-in controls and auto-submit until cleanup ends.
- 新增/优化：无。
- 工程与测试：XCTest `AccountLifecycleCoordinatorTests.testCleanupStartAndEndAreObservable`.
- 验证：hosted macOS CI (not run on the MacBook).
- 候选/发布：仅源码，无新候选。
- 剩余限制：no network or protection behaviour changes; the barrier semantics are unchanged.
