## 2026-09-30 · Stream resumed legacy installer downloads
- 归属：SHIP_PLAN §2 item 10; control-plane release download host.
- 来源：origin/main → hunt/sol-cp-stream-release-ranges; PR pending; not yet merged.
- 缺陷修复：Legacy ranged downloads consumed and copied the whole selected body before responding; now return the R2 range stream with the same 206 headers and bytes.
- 新增/优化：无。
- 工程与测试：One regression observes that the response is returned before its source stream is consumed, then verifies the range bytes and headers.
- 验证：Node 24/Linux; regression failed before the fix (`pulls` was 1 instead of 0); typecheck passed; focused release tests 3 passed; full `npm test` 45 files / 950 tests passed.
- 候选/发布：仅源码，无新候选; no deployment or publication.
- 剩余限制：No production Worker memory-exhaustion reproduction; real release objects were not changed.
