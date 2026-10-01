## 2026-09-30 · Ledger conditional reads observe edited rows
- 归属：ops plan §1.3 / control-plane ledger API correctness.
- 来源：origin/main `56de3c08` → `hunt/sol-r4cp-ledger-cache`; this PR source, not yet merged.
- 缺陷修复：Successful ledger edits left the page validator unchanged; If-None-Match returned 304 for stale rows. Include a SHA-256 of the already loaded page DTOs in its existing version tuple. R4CP-LEDGER-PAGE-VALIDATOR.
- 新增/优化：None; response fields, paging, unchanged-read 304 behavior and no-store remain unchanged.
- 工程与测试：One narrow Worker/D1 regression edits an existing entry and checks conditional reads before and after the edit.
- 验证：Linux / Node24; regression failed before the fix; ledger suite and typecheck results recorded in the PR. Baseline full control-plane suite passed 46 files / 974 tests before this delivery.
- 候选/发布：Source only, no new package, deployment or publication.
- 剩余限制：Current ops console does not use conditional reads; no shipped-console failure is claimed. Other endpoints' validators are outside this fix.
