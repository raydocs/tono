## 2026-09-30 · 账本冲销在原币合计里互相抵消
- 归属：运维台账导出（ops API 数据正确性），不进 0.0.74 客户包。
- 来源：`main` `cbb4f56a` 上的 `cursor/ledger-reversal-amount-a706`；未合 main。
- 缺陷修复：冲销行的 `amount_minor` 仍是非负金额（表约束），反向效果只写在 `cny_minor`。CSV 的原币合计以前按种类符号把冲销再加一遍，同一币种下 800 与冲销 800 合计成 1600。现在冲销行的原币贡献取反，人民币合计仍用已经取反的 `cny_minor`。
- 新增/优化：无。不改存储，也不改月结用的人民币合计。
- 工程与测试：`ops-ledger.test.ts` 一条 CSV 回归。
- 验证：`npx vitest run test/ops-ledger.test.ts`。修复前该回归得到 1600。
- 候选/发布：仅源码，无新包。
- 剩余限制：单行仍显示非负 `amountMinor`；只有合计列体现冲销。
