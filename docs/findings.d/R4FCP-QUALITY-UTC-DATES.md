| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FCP-QUALITY-UTC-DATES | Overview and node quality dashboards shift UTC daily SLO buckets to the prior local date | fixed | [#1067](https://github.com/raydocs/tono/issues/1067); [#1189](https://github.com/raydocs/tono/pull/1189) | 中·已确认（P2） | Visible value change requires ui-review; no auto-merge |

The backend floors SLO dayAt to UTC midnight. Both dashboards used local formatDate/formatDay for daily line tooltips/ticks and bar columns. Real rendered-component tests in America/Denver fail with2026-09-07/9/7 for the2026-09-08 UTC bucket. Use the existing UTC full-date helper and an explicit UTC month/day helper only at daily SLO consumers; actual event/sample timestamps keep local formatting.
