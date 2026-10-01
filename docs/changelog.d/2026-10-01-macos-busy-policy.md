## 2026-10-01 · Drain accepted macOS policies after runtime mutation
- 归属：SHIP_PLAN §2 item 10; macOS connected policy convergence.
- 来源：main `64e8b593` → branch `hunt/sol-r4fmc-policy-pending`; PR pending, not yet merged.
- 缺陷修复：#1114 accepted policy during a switch/reload/optional apply was discarded; retain the latest document rebuild and retire older queued pins.
- 新增/优化：无。Existing session ownership, AI admission and selective automatic release remain.
- 工程与测试：one XCTest pauses the real optional owner, accepts intermediate then empty policies, and requires final revocation without disconnect.
- 验证：Linux `git diff --check` passed. Swift/XCTest unavailable locally; native red/green execution not claimed, hosted macOS CI required.
- 候选/发布：仅源码，无新候选；no deployment/publication.
- 剩余限制：P2 overlap; real PF/TUN acceptance needs hardware. Catalog-removal convergence remains #1113.
