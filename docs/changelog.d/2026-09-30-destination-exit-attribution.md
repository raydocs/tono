## 2026-09-30 · Preserve exit attribution in destination totals
- 归属：ops plan data correctness; O1-DESTINATION-NODE (P2).
- 来源：origin/main `50bbbbf0`; branch `hunt/sol-misc-destination-node`; [#869](https://github.com/raydocs/tono/pull/869), not yet merged.
- 缺陷修复：same destination through two cloud exits collapsed into one row under the first exit; group totals by destination, route and exit.
- 新增/优化：无；days using the same exit still fold together.
- 工程与测试：one actual-component SSR regression, no mocks or screenshot baseline changes.
- 验证：Linux Node 20.19.2: regression failed before (12 connections/7KB under exit-a), passed after (5/3KB at exit-a, 7/4KB at exit-b); scoped Vitest 1/1, typecheck, scoped ESLint and git diff --check passed.
- 候选/发布：仅源码，无新候选；no deploy/publication.
- 剩余限制：ui-review, no auto-merge; browser visual review remains outstanding.
