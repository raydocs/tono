| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| O1-ACTIVITY-HOUR-COLLISION | Device rows and repeated local hours overwrite customer activity and connection presence | open | [#915](https://github.com/raydocs/tono/pull/915) | 低·已确认 | P2; user-hour/device-minute and repeated-hour representation require a product contract |

`services/ops-console/src/components/ops/HeatStrip.tsx:34` assigns one row to each local clock hour. The database primary key includes device (`migrations/0044_ops_customer_projections.sql:23`); `ops/customers-read.ts:117-135` returns all device hours, and `ops/handlers/customers.ts:398-408` maps each one while dropping its device identity. `pages/CustomerDetail.tsx:183` passes these rows directly to HeatStrip.

A connected device's 45 minutes/1000 bytes followed by another device's zero minutes/2000 bytes at the same UTC hour renders only zero minutes/2000 bytes. Actual production-component SSR in America/Denver reproduced this loss. On November1 2026, 07:00Z and08:00Z both render local01:00, so two distinct UTC hours also collide.

No source fix chosen. Summing device-minutes can exceed60 and cannot recover the union of connected intervals; maximum or clamping is not a union either. Required decisions: device-minutes versus customer wall-clock minutes, API interval/aggregation data, and how repeated local hours are represented. Traffic bytes have an additive interpretation, but silently changing the remaining displayed minute/presence semantics is not an authorized substitute. No DECISIONS.md edit.
