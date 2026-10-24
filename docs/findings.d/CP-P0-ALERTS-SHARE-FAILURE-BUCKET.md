| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-P0-ALERTS-SHARE-FAILURE-BUCKET | 普通 FAILURE 打满账户桶后 P0 网络丢失告警被 429，客户端丢弃报告 | in-PR | 本 PR · fix/t6-control-plane | 高·已确认（本地 D1 回归） | 本 PR 仅服务端；macOS 429 outbox 保留选交 T4、Windows 交 T5，认领/客户端结果由编排者协调 |

证据：基线 `telemetry/routes.ts:499,603` 共用 FAILURE。修复 `services/control-plane/src/telemetry/routes.ts:499`、`telemetry/diagnostics.ts:15`、`ops/ingest-limits.ts:73-90`：普通自动诊断独立 12/h、60/day，allowlist P0 独立 24/h、120/day（可由 Env 配置），仍按账户封顶、完整验证后写入。`request.ts:24` 为 429 附剩余窗口 `Retry-After`。
RED：`9c2939511` 两项失败；GREEN：`f63937e7d` P0/配置声明三项通过；见 [验证记录](../reports/t6-control-plane-verification-2026-10-24.md)。
