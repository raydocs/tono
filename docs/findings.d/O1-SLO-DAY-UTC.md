| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-SLO-DAY-UTC | UTC daily SLO statistics display the previous date west of UTC | in-PR | [#957](https://github.com/raydocs/tono/pull/957) | 低·已确认 | P2; ui-review, no auto-merge |

The Worker rolls up fixed UTC days (`slo-rollup.ts:10,141`, cron yesterday at `ops/cron.ts:245-258`), but `LedgerSlo` uses the general local-calendar formatter. September8 midnightUTC renders September7 in America/Denver. Use a dedicated UTC formatter for this bucket identity. Other bill/expiry dates retain their intentional local semantics.
