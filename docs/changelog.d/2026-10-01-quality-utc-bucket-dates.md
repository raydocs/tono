## 2026-10-01 · Preserve UTC days in quality dashboard labels
- Ownership: SHIP_PLAN §2 item 10; ops console quality data accuracy.
- Source: baseline `fdddde02`; branch `hunt/sol-r4fcp-quality-utc`; fixes #1067.
- Defect fix: daily UTC SLO buckets rendered as the preceding date west of UTC. Overview/node chart tooltips, ticks and bar labels now use UTC dates.
- Added/optimized: explicit UTC month/day formatter; UTC tick alignment for these daily charts; other charts retain local alignment. No totals, layout or event timestamp changes.
- Engineering/tests: one actual rendered-component regression per dashboard, with real charts and controlled measurement/cursor boundaries; both failed before the formatter fix.
- Verification: Linux Node24, npm ci passed; five targeted Vitest files/16 tests passed in America/Denver; typecheck passed (indexed-access171/219); targeted ESLint and diff check passed. No screenshot/native acceptance claimed.
- Candidate/publication: source only, no new candidate, deploy or publication. ui-review; no auto-merge.
- Remaining limits: user visual/value review required. Other local-day timeline buckets and real sample timestamps intentionally remain local.
