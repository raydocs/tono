## 2026-10-10 · ops 合同与客户时间线接受 `connectCancel`（A19 发现）
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)；Amp 待办 [A19](../ops/amp-backlog-2026-10-10.md) 的发现
  [OPS-TIMELINE-CONNECT-CANCEL-KIND](../findings.d/OPS-TIMELINE-CONNECT-CANCEL-KIND.md)。`services/control-plane`（ops 合同）、
  `services/ops-console`（客户时间线文案）。
- 来源：基线 main（#1494 合入后）→ 分支 `amp/a19-connect-cancel-kind`；PR [#1503](https://github.com/raydocs/tono/pull/1503)；未合 main。
- 缺陷修复：控制面展平（`FLATTEN_KINDS`）早已存 `connectCancel`（用户取消的连接），但 ops 合同 `CONNECTION_EVENT_KINDS`
  和控制台 `eventWord` 没有它：客户时间线这一行结果列为空，严格合同模式（`OPS_CONTRACT_STRICT=1`）下连接列表断言失败。
  → 合同词表加 `connectCancel`；控制台显示「取消连接」，灰色（不算失败、成功或换节点，天汇总计数不变）。
- 新增/优化：无。
- 工程与测试：`it('accepts a user-cancelled connect row the flattener stores')`（`services/control-plane/test/ops-contract.test.ts`），
  在 main 上失败（`connectionEvent.kind`），改后通过。
- 验证：Linux orb，Node 24：控制面 `npx vitest run test/ops-contract.test.ts` 159 通过；`npm run typecheck`（控制面、控制台）通过；
  控制台 `npx vitest run src/lib/customers.test.ts` 16 通过。CI 见 PR。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：无截图（只加一个词，颜色沿用已有灰色）。
