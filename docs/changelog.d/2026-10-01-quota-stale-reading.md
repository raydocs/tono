## 2026-10-01 · Stale interface readings no longer fabricate quota resets
- Scope: ops plan §2 item 4; node usage/quota correctness (`services/control-plane`).
- Source: origin/main `0676435b`; branch `claude/fix-1181-quota-stale-observation`; Issue [#1181](https://github.com/raydocs/tono/issues/1181).
- Fix: `rollNodeCycle` reads counters after the open cycle (callers pass a reader) and admits them with a compare-and-set on that cycle row. Previously an hourly roll that read counters before an overlapping profile save or roll committed a newer reading saw its older value as a counter reset and inflated `used_bytes` and `resets_detected`.
- Added behavior: none; real counter drops still count as resets, cycle replacement is unchanged, a profile quota change still applies when its reading loses the race.
- Regression: `test/ops-quota.test.ts` holds the reader while a newer roll commits; usage stays 100 with no reset. It fails on the old code and with the compare-and-set removed.
- Verification: macOS, local D1 (miniflare); `npx vitest run test/ops-quota.test.ts test/ops-api.test.ts test/ops-timeseries.test.ts` passed 81 tests; `npm run typecheck` passed; ops budgets ok.
- Release: source only; no package, deployment, or publication.
- Limits: a reading that loses the race is dropped for that hour; customer usage and network enforcement are unchanged.
