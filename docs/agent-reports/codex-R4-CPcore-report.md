Four fixes merged through CI. All had auto-merge enabled with merge commits; labels: none.

| ID | Area | Severity | File:line¹ | Description | Verdict |
|---|---|---|---|---|---|
| R4CPC-OIDC-BODY-UNAVAILABLE | OIDC | P3 | `oidc.ts:99` | Interrupted key response incorrectly returns 401 | Fixed in [#1176](https://github.com/raydocs/tono/pull/1176) |
| R4CPC-QUOTA-MINUTE-PAIR | Quota ingest | P2 | `ops-timeseries.ts:132` | Partial minute update erases complete counters | Fixed in [#1183](https://github.com/raydocs/tono/pull/1183) |
| R4CPC-CLOSE-REPLACEMENT | Account lifecycle | P2 | `ops/shared-admin/catalog.ts:83` | Concurrent replacement escapes account closure | Fixed in [#1186](https://github.com/raydocs/tono/pull/1186) |
| R4CPC-ACCESS-BODY-UNAVAILABLE | Access auth | P3 | `access.ts:112` | Interrupted key response appears as expired authentication | Fixed in [#1190](https://github.com/raydocs/tono/pull/1190) |
| R4CPC-QUOTA-STALE-SAMPLE | Node quota | P2 | `ops/quota.ts:288` | Older observations fabricate resets and inflate usage | Unfixed: [#1181](https://github.com/raydocs/tono/issues/1181); requires observation ordering preserved through retention |
| R4CPC-WITHDRAWN-LEDGER-RECOVERY | Usage recovery | P2 | `exit-identity-roster.ts:47` | Lost ledger rebills withdrawn users’ counters | Duplicate of #1069 / merged #1180; duplicate #1182 closed |

¹ Paths relative to `services/control-plane/src`; locations include pre-fix lines.

Each fix had a failing-then-passing regression. Local typechecking passed; the integrated suite passed **990 tests**, followed by complete CI for the final Access fix.

**42 hypotheses examined:** 28 false positives, nine duplicates, five newly verified bugs. The [full report and 42-row table](/workspace/w1-codex/out/R4-CPcore/report.md) include every rejected hypothesis and its reason.

All assigned files were read. Remaining work is #1181; complete agent files outside followed caller paths were outside this slot. No new P0/P1 bug was verified.