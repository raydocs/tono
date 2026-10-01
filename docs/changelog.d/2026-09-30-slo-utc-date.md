## 2026-09-30 · Keep SLO bucket dates in UTC
- 归属：ops plan data correctness; O1-SLO-DAY-UTC (P2).
- 来源：origin/main `2e5eb4de`; branch `hunt/sol-misc-slo-utc-day`; [#957](https://github.com/raydocs/tono/pull/957), not yet merged.
- 缺陷修复：September8 UTC SLO statistics appeared as September7 west of UTC; dedicated UTC formatter preserves bucket identity.
- 新增/优化：无；local bill/expiry date formatting untouched.
- 工程与测试：one actual-component SSR regression with a differing local day, independent of CI timezone.
- 验证：regression failed before with September7 and passed after. Existing extracted Node24.21.0: default Vitest1/1, typecheck, scoped ESLint and git diff --check passed. Original actual America/Denver component proof also failed before.
- 候选/发布：仅源码，无新候选；no deploy/publication.
- 剩余限制：ui-review, no auto-merge; full browser review awaits CI/owner.
