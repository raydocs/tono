| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R4FCP-OVERDUE-CUSTOMER-COUNTS | Customer dashboard removes overdue accounts when the API marks them expired | in-PR | #1068 | 中·已确认（P2） | Displayed KPI/chart values need ui-review; no auto-merge |

GET /ops/customers returns lifecycle=expired once an active account's paid time passes. The listStats and expiryWeeks active-only guards discarded that row before overdue counting. Regressions use actual expired lifecycle DTO shapes; both failed before the fix. Count active/expired past-expiry rows in overdue/lapsed reporting, but keep active load, usage, online and future-expiry calculations active-only and preserve suspended exclusions.
