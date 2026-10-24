| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-P0-OUTBOX-EVICTION | Windows P0 告警与普通报告共用有界队列，普通积压能淘汰尚未上传的 P0 | in-PR | fix/t5-windows | 中·已复现（P1，生产队列回归） | `telemetry_outbox.rs:30-36,78-154` 使用独立 P0 文件/容量，优先排队并按 kind+body 确认；保留旧混合队列中的 P0；同步文件事务串行化，网络 await 不持锁。[证据](../agent-reports/2026-10-24-t5-windows/README.md)。每队列仍有 32 条/256 KiB 上限；P0 自身超额仍淘汰最旧 P0；不承诺崩溃原子性或跨进程锁 |
