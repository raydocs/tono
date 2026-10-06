| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| OPS-NODE-JOB-RECEIPT-SUPPORT | 本次任务卡初稿等待当前 Worker 不提供的重启/同步身份变更回执，成功后稳定显示待验证并重复读12次 | in-PR | [#1396](https://github.com/raydocs/tono/pull/1396) | 低·已确认 | 仅本PR未上线初稿；cf03e21d 只对下架/上架等待回执，其余明确无回执；实际组件探针receiptReads=0。未合并/部署。 |

源证据：实际 `jobs-worker.ts` 仅 `catalog_retire`/`catalog_relist` 写与 jobId 关联的回执；不以契约枚举或客户端响应注入冒充后端支持。[续修记录](../changelog.d/2026-10-05-ops-workbench-workflow.md)。
