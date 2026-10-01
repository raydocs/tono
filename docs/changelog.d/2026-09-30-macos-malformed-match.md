## 2026-09-30 · Reject malformed developer-profile MATCH rules without crashing
- 归属：SHIP_PLAN §2 item 10; macOS crash fix, M14-MATCH-FLAG-CRASH (P3).
- 来源：origin/main `c32c087e`; branch `hunt/sol-misc-malformed-match`; [#818](https://github.com/raydocs/tono/pull/818), not yet merged.
- 缺陷修复：`MATCH,no-resolve` removed its only policy component before indexing it; validate the remaining count and ignore the malformed rule.
- 新增/优化：无；no UI or network change.
- 工程与测试：one XCTest exercises YAML rule import with a missing MATCH policy and a valid following rule.
- 验证：Linux source-path review and `git diff --check`; XCTest failing/passing execution is not runnable here and is delegated to macOS CI.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：the trigger is limited to the isolated developer profile. Native execution remains unverified locally.
