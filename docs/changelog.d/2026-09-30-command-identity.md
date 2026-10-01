## 2026-09-30 · Ops private command identity correctness
- 归属：ops plan customer data correctness; command palette.
- 来源：main `a3d4657e` → branch `hunt/sol-misc-command-identity`, PR [#969](https://github.com/raydocs/tono/pull/969); not merged.
- 缺陷修复：O1-COMMAND-IDENTITY-COLLISION separates customer/invite identities from their masked labels so Enter opens the selected person.
- 新增/优化：无。Search still uses displayed email and known WeChat handle; identity is excluded. Changed search fields remount cmdk items to refresh cached keywords.
- 工程与测试：one real cmdk DOM regression with a customer/invite sharing a private label.
- 验证：Linux existing Node24.21.0/default jsdom regression failed before by opening the customer instead of the selected invite, then passed; typecheck/scoped application ESLint/diff check passed. Existing system Chrome:8 existing search flows passed across light/dark, including private WeChat and invite searches. UI wrapper is excluded by the repository ESLint config and covered by typecheck/browser checks.
- 候选/发布：仅源码，无新候选；no deploy/publication.
- 剩余限制：ui-review, no auto-merge; no screenshot baselines changed.
