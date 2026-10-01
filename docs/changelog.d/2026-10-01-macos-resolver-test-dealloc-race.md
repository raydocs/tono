## 2026-10-01 · macOS: deflake the SYSTEM resolver deallocation assertions
- 归属：SHIP_PLAN §2 item 10；macOS test reliability (blocks ci-gate on unrelated PRs).
- 来源：main `ed6dee0d` → `fix/macos-resolver-test-dealloc-race`.
- 缺陷修复：`ProtectedSystemResolverTests` asserted `next.deallocations == 1` right after the waiter returned, but `finish()` resumes the waiter before its async dispose on `ownershipQueue`, so the assertion raced (failed in runs 36846871490 and 36845936205 on PRs that do not touch macOS). Both assertions now drain the owner queue first, as the `held` assertions in the same test already do. Product code unchanged.
- 新增/优化：无。
- 工程与测试：test-only.
- 验证：hosted macOS CI (no Swift on this Mac).
- 候选/发布：仅源码，无新候选。
- 剩余限制：none known.
