## 2026-10-01 · Windows AI tally account isolation and bounded receipts

- 归属：SHIP_PLAN §2 item 10; Windows frontend account isolation and local traffic accounting.
- 来源：baseline `6ba79f61`; branch `hunt/sol-r4i1085-ai-tally`, issue #1085. Source fix pending merge through CI.
- 缺陷修复：`R3REGW-AI-TALLY-ACCOUNT-SCOPE` (P2) scopes account reads to the current sign-in lifetime and hides ownerless history; `R3REGW-AI-TALLY-SEEN-GROWTH` (P3) bounds historical flow receipts at 2,500 while retaining current-frame and recent remount deduplication.
- 新增/优化：无。Rendered JSX, copy, styles, local storage key format and network policy are unchanged.
- 工程与测试：One narrow regression per behavior. Component test uses actual SWR; receipt test retains 2,000 active IDs while rotating 6,000 completed IDs through 500-entry windows. No tests skipped or gates changed.
- 验证：Linux, Node 24.21.0 / pnpm 11.26.0, frozen lockfile install with ignored scripts. Baseline: `Tests 2 failed | 1 passed (3)`; A's Claude row remained visible and 8,000 receipts remained. Fixed focused component/tally/account/feed tests: `Tests 7 passed (7)`. Typecheck passed: `unchecked indexed access errors 79 (baseline 79)`. Targeted ESLint and diff/record checks passed. Hosted CI receipts are recorded in the PR body. Windows native/Tauri execution was not run here.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：The 2,000-active feed is truncated; an evicted ID can recount if it reappears much later. No OOM/hang qualification is claimed. #1089 separately handles the OS-directory row of #1085; enterprise NRPT decision remains #1145.
