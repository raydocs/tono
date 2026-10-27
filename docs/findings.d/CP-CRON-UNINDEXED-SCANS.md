| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-CRON-UNINDEXED-SCANS | 五分钟 cron 多处每轮全表扫描（过期 pending 设备、`ops_incident_events`/`customer_activity_hours`/`service_usage_daily`/`direct_candidate_daily` 保留），另每轮对每个客户写一次未变化的 `path_streak` | in-PR | fix/exit-agent-metering-durability | 低·已测量（本地 D1，2 万行/表） | `path_streak` 只写变化值已修（2 万→0 条语句/轮）；索引只进 `docs/ops/diagnostics-retention-index-candidate.sql`（本地测 27.4 万→17.4 万行读/轮），需 owner 在 preview D1 演练后再建迁移；`loadRollups` 聚合 join 与 `failure_cluster_members` 保留 join 仍全扫 |
