## 2026-09-30 · 节点配额跨周期的关闭与建档同一批提交
- 归属：ops 计划 §2（配额记账不丢基线）；控制面 `services/control-plane/src/ops/quota.ts`。发现 CP-QUOTA-ROLLOVER-GAP 的剩余缺口。
- 来源：基线 `50bbbbf0` → 分支 `cursor/cp-quota-rollover-atomic-f0e7`（本分支 PR），未合 main。#780 已合入的跨界继承不变。
- 缺陷修复：过期周期先单独 `UPDATE` 成 closed，再 `INSERT` 新周期。插入失败时节点没有 open 周期，下一次采样把当前计数当成基线，末次读数到这次读数之间的流量不再计入。现在关闭和插入是同一个 D1 批次。插入失败会回滚关闭，旧周期保持 open，重试仍继承 `counter_*_last`。没有下一周期边界时仍只关闭，不插入。
- 新增/优化：无。
- 工程与测试：`keeps the expired cycle open when opening the next one fails`。
- 验证：Linux 上 Node v22.22.2（本环境没有 Node 24），`npx vitest run test/ops-quota.test.ts`：12 passed。全量 `npm test` 未跑。
- 候选/发布：仅源码，无新候选。不部署、不写生产 D1。
- 剩余限制：操作员把配额设为 null 时的 `closeOpenCycle` 仍是单独关闭，那里本来就不建下一周期。
