## 2026-09-30 · Ops device standing read errors
- 归属：ops plan customer data correctness.
- 来源：main `0f6d4286` → branch `hunt/sol-misc-device-read-error`, PR [#968](https://github.com/raydocs/tono/pull/968); not merged.
- 缺陷修复：O1-DEVICE-READ-ERROR preserves an initial standing read failure instead of claiming no action history, and blocks toggling an unknown diagnostics window.
- 新增/优化：无。Independent queued commands and revocation remain available.
- 工程与测试：one actual Devices component regression with a failed resource.
- 验证：Linux existing Node24.21.0 default jsdom test failed before at the missing error message, then passed after; typecheck/scoped ESLint/diff check passed. No screenshot changes.
- 候选/发布：仅源码，无新候选；no deploy/publication.
- 剩余限制：ui-review, no auto-merge. Existing retained-ready data behavior on later refresh failures is outside this initial-load fix.
