| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SOL-CP-CLUSTER-LAST-SEEN | 延迟上传倒退集群最后时间，使持续故障被误判为结束并另开集群 | fixed(70478aba) | hunt/sol-cp-cluster-last-seen | P2·已复现 | 既有 30 分钟静默边界和告警门槛不变 |

Both cluster-join paths now update `last_seen_ms` with `MAX`. The single regression sends a current report, a one-hour-old delayed report, then a current report one minute later; all three must remain in the same open outage. Before the fix the third report opens a new cluster.
