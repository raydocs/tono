| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| OPS-ERRORS-HOME-UTC-DATES | Node error and home-line usage bars label UTC day buckets with the previous local date west of UTC | fixed | [#1200](https://github.com/raydocs/tono/issues/1200); [#1212](https://github.com/raydocs/tono/pull/1212) | 低·已确认（P2） | UI date label only; real timestamps keep local formatting |

Both bars are UTC-midnight buckets (`quota.ts`, `home-lines.ts`). They now use the existing `formatUtcDate`, as #1189 did for Quality.
