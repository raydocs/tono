## 2026-09-30 · Keep stale page reads visible
- 归属：ops plan freshness (OPS-1); O1-PAGE-FRESHNESS (P2).
- 来源：origin/main `5ba113d2`; branch `hunt/sol-misc-page-freshness`; [#880](https://github.com/raydocs/tono/pull/880), not yet merged.
- 缺陷修复：a successful shared health read hid an old page-specific answer behind “本页截至 刚刚”; four page stamps now use the oldest available displayed input.
- 新增/优化：无；retain old data on transient errors and retain shell last-contact semantics. Page warning now describes old data instead of claiming backend silence.
- 工程与测试：one actual Clients page SSR regression with hour-old releases and fresh health; no mocks or screenshot baseline changes.
- 验证：Linux Node 20.19.2: regression failed before (just-now stamp), passed after (page-specific stale warning); scoped Vitest 5/5 (regression + copy guards), typecheck, scoped ESLint and git diff --check passed.
- 候选/发布：仅源码，无新候选；no deploy/publication.
- 剩余限制：ui-review, no auto-merge. This corrects existing page-stamp inputs; secondary reads not already included remain outside the stamp. It does not add polling to page-local resources. Browser visual review remains outstanding.
