## 2026-09-30 · Retire macOS wake recovery before native update release
- 归属：SHIP_PLAN §2 item 10；macOS connection lifecycle / native-update handoff.
- 来源：main `7e5c333a` → branch `hunt/sol-r3conn-update-wake-retirement`; PR pending, not yet merged.
- 缺陷修复：a wake retry surviving a failed update could reconnect after Disconnect and Retry released and retired that update. Suspension now captures, cancels and drains wake/sleep owners, then retires their handles only in the current generation; the pending wake-resume flag is cleared.
- 新增/优化：none; existing PF, DNS, AI blocking, strict-mode behavior and helper contract retained.
- 工程与测试：one regression drives actual wake recovery and update Disconnect with a held non-cancellable helper reply; release must wait for cancellation/drain and leave no wake owner.
- 验证：Linux `git diff --check` passed; regression authored before the behavior change. Swift/Xcode/XCTest unavailable locally; no executed native failing-then-passing claim. Hosted macOS CI required.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：needs-hardware for update download spanning sleep/wake, failed preparation, explicit retirement and declining the retry offer. #991 separately owns cancelled reload-handle retirement.
