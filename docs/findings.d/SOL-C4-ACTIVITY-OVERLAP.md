| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-C4-ACTIVITY-OVERLAP | Overlapping telemetry windows of one device summed past 60 minutes in one hour | in-PR | [#1058](https://github.com/raydocs/tono/issues/1058) | 低·推导 (P3) | Capped at 60 per device-hour on write and read; overlap is bounded, not deduplicated; Worker deploy needed |
