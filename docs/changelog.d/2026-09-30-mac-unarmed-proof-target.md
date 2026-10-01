## 2026-09-30 · Keep macOS unarmed recovery on a proved TCP target

- 归属：SHIP_PLAN §2 item 10; macOS recovery after ordinary automatic release.
- 来源：origin/main `89a0e0e7` → `hunt/sol-r4sw-mac-unarmed-target`; PR #1086; source only.
- 缺陷修复：automatic recovery waits for completed teardown, considers the preferred TCP node plus at most two same-region TCP alternatives, and selects/persists the exact proved node before Connect. Remembered HY2 cannot suppress TCP retries; a proof cannot reconnect an unproved stale selection.
- 新增/优化：无；existing AI-preserving release, generation fences, strict barrier checks and bounded TCP proof retained.
- 工程与测试：four narrow regressions for HY2 exclusion, real backup admission, the distinct retry owner surviving a slow queued release, and increasing delay across failed automatic admissions. Existing explicit-Restore cancellation regression uses a real managed node fixture.
- 验证：`git diff --check` passed; source assertions confirm release wait and proved-selection admission; independent read-only Swift/task ownership review passed. No Swift toolchain on Linux; XCTest/compile not run locally and require hosted macOS CI.
- 候选/发布：仅源码，无新候选；no deploy/publish.
- 剩余限制：needs-hardware for unreachable preferred node, HY2 sibling and delayed Core/DNS/PF cleanup; automatic connection failures retain the next backoff rung, resetting on verified success or fresh Connect intent.
