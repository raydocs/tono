## 2026-10-01 · macOS full config reload failure restores ordinary internet
- 归属：SHIP_PLAN §2 item 10 / G1；macOS connection/config recovery.
- 来源：`64e8b593` → branch `hunt/sol-r4ma-reload-failure-release`; PR pending, not yet merged.
- 缺陷修复：a failed full runtime replacement no longer stops Core while holding bootstrap PF and dead-loopback DNS through retries; the existing selective automatic release restores ordinary internet and retains AI-service blocking before bounded unarmed proofs.
- 新增/优化：无；strict disposition and pins-only keep-session recovery remain unchanged.
- 工程与测试：one XCTest drives the actual full reload sync-failure catch and checks DNS restoration, retained AI hold, no explicit disarm/bootstrap restriction, and unarmed retry ownership.
- 验证：Linux source tracing and diff/record checks; Swift/XCTest cannot execute here and require hosted macOS CI. No failing-then-passing native execution claimed.
- 候选/发布：仅源码，无新候选；no deploy or publish.
- 剩余限制：PF/DNS/device acceptance needs hardware. Existing automatic release failures and the pending-update branch tracked in #1099 are unchanged.
