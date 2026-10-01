## 2026-10-01 · Rehearse restored D1 migrations with generated preview configuration
- 归属：SHIP_PLAN §2 item 10；D1 release/migration validation tooling.
- 来源：main `fdddde02` → `hunt/sol-r4rel-preview-migrations`; not yet merged.
- 缺陷修复：restore only checked the retired preview config filename and silently skipped migrations with the current renderer's output. It now prefers that generated config and retains legacy fallback.
- 新增/优化：无；the selected config's database UUID is checked against both production bindings before any remote call, then reused for migrations.
- 工程与测试：two narrow copied-script/fake-npx regressions cover generated-config migration execution and production-ID refusal before any calls. All dump/checksum fixtures are synthetic and isolated.
- 验证：Linux Node; baseline 1 passed / 2 failed; focused restore/wipe/numbering 33 passed / 0 failed; sh -n and git diff --check pass. All 83 migrations passed empty and representative populated SQLite audit.
- 候选/发布：仅源码，无新候选；no real D1/Wrangler operation, deployment or publication.
- 剩余限制：SQLite/offline command fixtures do not establish real Cloudflare restore/deploy acceptance.
