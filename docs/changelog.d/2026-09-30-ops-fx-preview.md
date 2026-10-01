## 2026-09-30 · Preview the ledger's UTC posting-day exchange rate
- 归属：ops plan billing correctness; O1-FX-PREVIEW-DATE (P2).
- 来源：origin/main `50bbbbf0`; branch `hunt/sol-misc-fx-preview`; [#848](https://github.com/raydocs/tono/pull/848), not yet merged.
- 缺陷修复：backdated payments previewed historical FX but saved current posting-day FX; preview and missing-rate messages now match the approved UTC posting-day rule.
- 新增/优化：无；payment date remains independent. Correct the existing field hint and missing-rate suggestion to describe posting-day FX.
- 工程与测试：strengthen the existing foreign-entry e2e with a historical payment; preserve missing-rate coverage through a 409 endpoint fixture. Correct fixture POST to match the Worker.
- 验证：Linux Node 20.19.2: ledger Vitest 22/22, typecheck, scoped ESLint and git diff --check pass. Local fixture HTTP proof previews/posts 12 USD as 8,561 CNY minor units at 2026-09-08 FX despite a January payment. Playwright attempted; both tests could not launch because Chromium is absent. No browser result claimed.
- 候选/发布：仅源码，无新候选；no deployment or publication.
- 剩余限制：ui-review; no auto-merge. Browser and screenshot review await CI/owner; no baseline images updated. Crossing UTC midnight or a rate-table update between preview and submit is not a locked quotation.
