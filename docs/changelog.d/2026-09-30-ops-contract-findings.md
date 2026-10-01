## 2026-09-30 · Record remaining ops data contract defects
- 归属：ops plan data correctness; O1-ADOPTION-DRILLDOWN, O1-ADOPTION-TOTAL, O1-ANCHOR-CLAMPED, O1-ACTIVITY-HOUR-COLLISION (P2).
- 来源：origin/main `36844a4a`; branch `hunt/sol-misc-ops-contract-findings`; [#915](https://github.com/raydocs/tono/pull/915), not yet merged.
- 缺陷修复：无；persist four source-traced, real-unfixed findings so parallel hunters can dedupe them.
- 新增/优化：无；record exact triggers, caller/callee paths and needed API/semantic work. Do not change DECISIONS.md or choose a product decision.
- 工程与测试：documentation only; records parser/diff checks only, no new regression or product test result claimed.
- 验证：each finding read through console callers and Worker derivation/persistence; records.mjs per-ID output and git diff --check passed.
- 候选/发布：仅文档，无新候选；no deploy/publication.
- 剩余限制：all four remain open. No API, console UI, network behavior or gate changes.

- 2026-09-30 续记：added HeatStrip device-hour and DST collision proof; no aggregation semantics guessed. Read-only actual-component SSR and exact Worker/database path recorded. Tooling engineering limitations stay outside the product ledger per its maintenance rule: registration scanner does not understand wildcard invocations; aggregate omits the required emitted install script; aggregate suppresses an intentional signing-identity SKIP and counts exit0 as passed. No gates or native skip behavior changed.
