## 2026-10-01 · Preserve complete quota counters within one minute
- Scope: ops plan §2 item 4; node usage/quota correctness.
- Source: origin/main `afb98c5d`; branch `hunt/sol-r4cpc-quota-minute-pair`, PR [#1183](https://github.com/raydocs/tono/pull/1183).
- Fix: a second, incomplete observation in a minute no longer erases that minute's already complete cumulative counter pair. Previously quota could fall back to an older pair, infer a reset, and count old traffic twice.
- Added behavior: none; gauges still use the incoming observation, partial pairs still replace partial pairs, and complete lower pairs still establish real resets.
- Regression: real Worker/D1 test failed because the quota reader returned the preceding minute's counters, then passed with stable usage, updated CPU, normal growth, and a genuine reset.
- Verification: Linux, Node 22.14.0; `npm run typecheck` passed; `npx vitest run test/ops-timeseries.test.ts test/ops-quota.test.ts` passed 29 tests.
- Release: source only; no package, deployment, or publication.
- Limits: broader out-of-order quota admission is tracked separately; customer billing and network enforcement are unchanged.
