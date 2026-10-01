## 2026-10-01 · macOS helper removes pre-receipt AI sinkhole resolvers
- 归属：SHIP_PLAN §2 item 10 / G1，macOS helper `SelectiveFailOpen.swift`; helper 4.52.29 → 4.52.30.
- 来源：baseline `b9ab47db`; branch `hunt/claude-reglate-mac-resolver`; found by the RegLate macOS regression pass (#1141 × connected DNS audit).
- 缺陷修复：REGLATE-MAC-F3. Helpers before 4.52.27 (including the 2026-10-01 05:12Z signed candidate from `stability/desktop-0.0.74-20260926` @ `7d33a838`) wrote `/etc/resolver/<AI suffix>` sinkholes without a receipt. Receipt-based cleanup skipped them, and apply recorded them as the user's "original", so arm restored them. The connected DNS audit counts `192.0.2.1` as a supplemental conflict and holds PF with retries paused, i.e. every connect on such a Mac lost the network in non-strict mode. Cleanup now deletes a receipt-less file whose bytes equal the exact Tono sinkhole body (also when the receipt directory does not exist yet), and apply records such a file as absent.
- 新增/优化：无。Foreign or administrator resolver files are untouched (only the exact Tono body is removed).
- 工程与测试：`runResolverOwnershipSelfTest` gains a pre-receipt sinkhole before the receipt directory exists, and an apply over a pre-receipt sinkhole.
- 验证：`test-core-helper-contract-guard.sh` PASS; CONTRACT hash recomputed with the build script's manifest. Helper self-test runs in hosted macOS CI only (needs root); nothing run against live PF/DNS on the MacBook.
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware: verify on a Mac that ran a helper older than 4.52.27 with an automatic release.
