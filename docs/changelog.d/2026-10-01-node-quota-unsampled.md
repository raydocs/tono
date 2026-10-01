## 2026-10-01 · 无采样时不要把节点配额基线记成 0

- 归属：ops 计划 §2（节点配额记账）。不改客户用量，不改 schema。
- 来源：`origin/main`；分支 `cursor/node-quota-unsampled-2c38`。仅源码，未合 main。
- 缺陷修复：保存配额时如果还没有接口计数，周期的计数基线保持空。下一次真实读数确立基线，用量仍是 0。关联 NODE-QUOTA-ZERO-BASELINE。
- 新增/优化：无。
- 工程与测试：`PATCH profile quota without a sample does not baseline the cycle at zero`。修复前 `counter_in_last` 为 0，断言失败。
- 验证：本机 Node 22，`npx vitest run test/ops-api.test.ts -t "does not baseline"` 修复前失败、修复后通过；`npx vitest run test/ops-quota.test.ts` 11 passed。CI 用的 Node 24 未在本机安装，未跑完整 `npm test`。
- 候选/发布：无新包。
- 剩余限制：与 #811 / #852 的周期滚动原子性是不同缺口。本机没有 Node 24。
