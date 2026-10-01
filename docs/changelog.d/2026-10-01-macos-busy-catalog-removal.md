## 2026-10-01 · Converge catalog removal after a busy macOS runtime owner
- 归属：SHIP_PLAN §2 item 10; macOS catalog/session convergence.
- 来源：main `6ba79f61` → `hunt/sol-r4fmc-catalog-removal-pending`; PR pending.
- 缺陷修复：#1113 removal during an active switch/reload persisted a survivor without runtime work; queue latest-catalog settlement and retain selective release on failed convergence.
- 新增/优化：无。No helper contract, strict policy, AI admission or visual string changes.
- 工程与测试：one XCTest holds a real optional-policy owner, installs two successive removal catalogs, models old runtime completion and requires the latest survivor at drain.
- 验证：Linux `git diff --check` passed; native XCTest/Swift unavailable, native red/green execution not claimed.
- 候选/发布：仅源码，无新候选；no deploy/publish.
- 剩余限制：P2 lifecycle overlap; PF/TUN acceptance requires macOS CI and hardware.
