## 2026-10-01 · macOS pin refresh respects newer policy revocations
- 归属：SHIP_PLAN §2 item 10 / G1；macOS managed DIRECT authorization.
- 来源：`ad8ab2cd` → branch `hunt/sol-r4ma-pin-refresh-freshness`; PR pending, not merged.
- 缺陷修复：old DNS answers completing after a successfully applied policy revocation no longer reinstall the captured DIRECT grants. Resolution must retain the same policy, active runtime plan and protection generation before scheduling any replacement.
- 新增/优化：无；current-policy resolution and AI routing guards unchanged.
- 工程与测试：one suspended-resolver XCTest completes an accepted empty policy through the actual optional apply owner, then releases old changed pins and requires zero stale reload/PF arms. Resolver injection is test-only; production uses the existing resolver.
- 验证：Linux source tracing, diff and records parser checks. Swift/XCTest execution requires hosted macOS CI; native failing-then-passing execution is not claimed.
- 候选/发布：仅源码，无新候选；no deploy or publish.
- 剩余限制：overlapping busy-policy coalescing is already tracked in #1114 and remains separate. Native PF/DIRECT acceptance needs hardware.
