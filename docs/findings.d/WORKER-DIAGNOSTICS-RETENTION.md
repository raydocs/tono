| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WORKER-DIAGNOSTICS-RETENTION | 诊断保留删除无 LIMIT，且 received_at/opened_at 无索引，五分钟 cron 会全表扫 | in-PR | 待开 | 中·已确认 | 本 PR 只加了 LIMIT。索引候选在 docs/ops/diagnostics-retention-index-candidate.sql，未进 migrations，待 owner 在 staging 演练后再加迁移 |

`services/control-plane/src/retention.ts` 里 `client_sessions`、`chain_hops`、`session_exit_observations`、`dns_checks`、`ai_service_routes`、`failure_clusters` 的删除原先没有 `LIMIT`。`migrations/0093_client_diagnostics.sql` 给这些表建的索引在用户和时间或 `last_seen_ms` 上，没有 `received_at` / `opened_at`。`diagnostics_reports`、`telemetry_windows` 已有 `received_at` 索引，`failure_alert_sends` 已有 `sent_at` 索引。

本 PR 把上述删除改成每轮最多 `RETENTION_DELETE_BATCH`（500）行，与 sessions / usage_reports / ops_audit 相同。`failure_cluster_members` 先按批删，集群行要等成员空了才删，避免先删集群留下无人引用的成员。`rate_limits` 的 `window_start` 同样没有索引，删除也改成了分批；索引候选里单独注释，不和诊断表绑在一起。

不在本 PR 加 migration。
