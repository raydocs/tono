## 2026-10-01 · Preserve UTC days in node error and home-line usage bars
- Ownership: ops plan (docs/ops/plan-2026-09-11.md), ops console data accuracy; not a ship gate.
- Source: branch `claude/fix-1200-utc-bucket-labels`; fixes #1200.
- Defect fix: node daily error bars and home-line daily usage bars are UTC-midnight buckets but their tooltips used the local date formatter, so operators west of UTC saw the preceding date. Both now use `formatUtcDate`. Real timestamps (for example the line's expiry) keep local formatting.
- Engineering/tests: one rendered regression per component (`Errors.test.tsx`, `HomeLineDrawer.test.tsx`); `UsageStrip` is now exported for the test. The Errors regression failed before the fix.
- Verification: `TZ=America/Denver npx vitest run src/pages/node src/pages/settings` 4 tests passed; `tsc --noEmit` and targeted ESLint clean.
- Candidate/publication: source only, no new candidate, deploy or publication.
