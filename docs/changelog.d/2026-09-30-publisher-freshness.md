## 2026-09-30 · Ops publication metadata and history freshness
- 归属：ops plan data correctness; settings publishers.
- 来源：main `63080fdf` → branch `hunt/sol-misc-publisher-freshness`, PR [#965](https://github.com/raydocs/tono/pull/965); not merged.
- 缺陷修复：O1-PUBLISH-METADATA applies returned timestamp/signature/fingerprint, and O1-CATALOG-HISTORY refreshes an already open history when the online revision changes.
- 新增/优化：无。Existing draft and compare-and-swap behavior preserved.
- 工程与测试：one new unsigned-policy browser regression; existing catalog publication regression now also asserts history.
- 验证：both checked-in regressions failed before the source fix. Linux existing system Chrome, focused checked-in publishing/conflict/rehearsal flows: 10 passed across light/dark. Existing Node24.21.0: typecheck and scoped ESLint passed; diff check passed. No snapshot updates.
- 候选/发布：仅源码，无新候选；no deploy/publication.
- 剩余限制：visible metadata correction requires ui-review; no auto-merge. History API failure uses its existing error state.
