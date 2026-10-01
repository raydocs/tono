## 2026-09-30 · Preserve complete node counters through retention
- Ownership: SHIP_PLAN §2 item 10 reliability hunt; operations node-quota display and forecasting.
- Source: baseline `1fb29265`; branch `hunt/sol-r3ingest-quota-rollup-counters`; not yet merged.
- Defect fix: an incomplete closing traffic observation erased the most recent complete counter pair at raw→5-minute and 5-minute→hour retention. The quota reader then fabricated a reset from older counters. Keep each tier's latest complete pair so missing measurements cannot create recovery overcount.
- Additions/optimization: none. Gauge aggregation, genuine reset handling, customer billing, AI-service blocking and strict-mode behavior remain unchanged.
- Engineering/tests: one narrow regression per retention tier; the raw regression also traces the false-reset/recovery consequence through the real quota functions. No schema migration.
- Validation: Linux Node24.21.0, `npm ci`, `npm run typecheck`, `npx vitest run test/ops-timeseries.test.ts test/ops-quota.test.ts` — 28 tests passed. Both new regressions failed before the fix, selecting1000 instead of10000. `git diff --check` passed; independent read-only review found no substantive issue.
- Candidate/publication: source only; no new candidate, deployment or publication.
- Remaining limits: counters must be missing until the 48-hour/7-day retention boundary; supported-ingest/D1 reproduction only, no production transition or incident claim. Existing corrupted historical counters cannot be reconstructed from erased source rows.
