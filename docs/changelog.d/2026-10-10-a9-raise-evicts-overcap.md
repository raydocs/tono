## 2026-10-10 · 调高设备上限不再踢已超额账户的设备（A9-RAISE-EVICTS-OVERCAP）
- 归属：ops 计划（[amp-backlog-2026-10-10](../ops/amp-backlog-2026-10-10.md) A9 遗留，决策 D15-A）；控制面 `PATCH /api/v1/admin/users/:id`。
- 来源：基线 origin/main a6ebf460 → ea531f48；分支 `amp/a9-raise-evicts-overcap`；未合 main。
- 缺陷修复：只要请求带 `deviceLimit` 就按 LRU 驱逐超额设备，对 #1487 之前已超额的账户（5 台在线、上限 1）把上限调到 3
  会撤销两台 → 现在同一 D1 批次（同一事务）先选驱逐对象、再写上限，选择条件是新上限小于当时库内的旧上限；
  调高或不变不驱逐，账户照旧在下次登录时追上。调低时的行为（只动该账户、LRU、审计、失败整体回滚）不变。
- 新增/优化：无。
- 工程与测试：`evictDevicesOverLimit` 改为必传新上限与上限写语句；`test/worker-devices.test.ts` 现有
  「only when the device limit is lowered」`it` 增加遗留超额场景。
- 验证：Linux orb、Node 24.18.0，`services/control-plane`：改前该 `it` 失败（期望 5 台在线，实得 3）；改后
  `npx vitest run test/worker-devices.test.ts` 30 passed；`npm test` 64 files / 1019 tests passed；`npm run typecheck` 通过。
- 候选/发布：仅源码，无新候选；控制面未部署。
- 剩余限制：无。
