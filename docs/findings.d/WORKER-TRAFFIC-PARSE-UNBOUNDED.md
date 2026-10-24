| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WORKER-TRAFFIC-PARSE-UNBOUNDED | 流量审计段不夹紧客户端时间，目的地/候选 map 无上限 | in-PR | 待开 | 中·已确认 | 已写入的未来 day 行不会被这次解析改动删掉 |

`services/control-plane/src/ops/traffic-parse.ts` 的 `tsMsOf` 直接采用客户端 ISO 或数字时间。未来时间会写成 `traffic_*_daily` / `direct_candidates` 里保留任务（`day_at < cutoff` / `last_seen < cutoff`）删不掉的行。夹紧方式与 `ops/ingest-hooks.ts` 的连接失败和 `telemetry/diagnostics.ts` 的事件相同：不超过收到时间，更早的时间保留。

`destinations`、`services`、`candidates` 现在停在 `MAX_PARSE_BUCKETS`（`MAX_DISTINCT_ETLD1 + 1`）。多出来的新键不再入库，已有键继续累加。多出的一格是为了同一天 2000 个 eTLD+1 之后仍能落下 `__other__`。
