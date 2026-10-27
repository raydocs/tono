| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-CRON-UNINDEXED-SCANS | 五分钟 cron 有两处每轮全表扫描：`scheduled.ts` 过期 pending 设备查询（`devices` 只有 `(user_id,status)` 索引），`ops/cron.ts` 的 `ops_incident_events` 按 `at` 保留（索引以 `incident_id` 开头）；另有 `routing_research_snapshots` 与 `ops-timeseries.ts` 的 DELETE 没有 LIMIT | open | 待开 | 低·推导（读码） | 表目前都小，无实测成本；修法需新 migration（先在 preview 演练），与 WORKER-DIAGNOSTICS-RETENTION 的索引候选一起处理 |
