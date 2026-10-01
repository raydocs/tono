## 2026-09-30 · Preserve fractional node quotas through profile edits
- 归属：ops plan §2 supporting data correctness; O1-QUOTA-ROUNDTRIP (P2).
- 来源：origin/main `7d525e6c`; branch `hunt/sol-misc-quota-roundtrip`; [#825](https://github.com/raydocs/tono/pull/825), not yet merged.
- 缺陷修复：a fractional GB allowance was rounded in the profile field and written back on unrelated saves; show the fractional value so normal allowances round-trip.
- 新增/优化：无；no layout or copy change. Existing fractional values are now visible in the quota field.
- 工程与测试：one Vitest regression round-trips a quota with a fractional GB component.
- 验证：Linux Node 20.19.2, `npm ci --ignore-scripts`; focused Vitest with `--environment node` failed before (2,000,000,000 instead of 1,500,000,001) and passed after (32/32). Typecheck, scoped ESLint and `git diff --check` passed. Native/browser UI review not performed.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：ui-review; auto-merge disabled. Existing floating-point input conversion can lose a byte near Number.MAX_SAFE_INTEGER, far above ordinary node allowances; not changed here.
