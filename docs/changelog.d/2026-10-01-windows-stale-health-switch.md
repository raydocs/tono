## 2026-10-01 · Windows hot switch rejects an old exit's health failure
- 归属：SHIP_PLAN §2 item 10; Windows connection lifecycle.
- 来源：origin/main c6c08737; branch hunt/sol-r4fws-health-switch; source PR, not yet merged.
- 缺陷修复：#1093 / #1095, old A proof failure after a successful same-generation A→B hot switch no longer releases B. Failure admission checks captured selection under policy/lifecycle ownership; the current monitor continues.
- 新增/优化：无。Automatic release retains its secondary AI hold; strict and policy rebuild paths retain their existing disposition.
- 工程与测试：one narrow actual admission regression; no CI/dependency changes.
- 验证：Linux Rust 1.98.1 boundary fixture compiles the exact production helper and committed test with the real portable ConnectionFsm. Before: 0 passed / 1 failed (“an old A proof must not dispatch release against B”); after: 1 passed / 0 failed. git diff --check passed. Full Windows/Tauri and real WFP/DNS not runnable here.
- 候选/发布：仅源码，无新候选；未部署、发布。
- 剩余限制：needs-hardware; fixture excludes the native Service/controller and models only the state/lock boundary.
