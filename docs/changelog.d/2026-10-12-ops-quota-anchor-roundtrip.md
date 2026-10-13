## 2026-10-12 · 运维台：节点档案抽屉的额度锚定日读服务端保存值，不再从本期开始日倒推
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/control-plane` 与 `services/ops-console`，无迁移。
- 来源：基线 `origin/main` → 分支 `fix/ops-quota-anchor-roundtrip`；未合 main。问题单 #1058 行 O1-ANCHOR-CLAMPED。
- 缺陷修复：节点档案抽屉：额度周期的锚定日改为读服务端保存的配置值，不再从本期开始日倒推；之前配置为 31 日的节点在二月只改备注也会把锚定日存成 28。
  - 原因：节点详情的 `NodeQuotaDto` 只带 `cycleStart` / `cycleEnd`，控制台用本期开始日的 UTC 日号还原表单里的锚定日；31 日的锚定在二月本期从 28 日开始，整张表单随备注一起存回 `cycleAnchorDay: 28`。
  - `NodeQuotaDto` 新增 `cycleAnchorDay: number | null`（1–31 为日历日，大于 31 为周年起点，未设为 null），由 `quotaDto` 从 `ops_node_profiles.cycle_anchor_day` 填入；`assertNodeQuota` 与 `QUOTA_KEYS` 同步。服务端的钳位与周期计算不变。
  - 控制台新增 `anchorDayField(quota)`（`src/lib/node-detail.ts`）：有 1–31 的配置值就用它，否则（未设或为周年起点）退回 `anchorDayOf(cycleStart)`。`ProfileDrawer` 只改这一行。批量设置抽屉自己填值，不读本期开始日，不受影响。
- 工程与测试：`test/ops-api.test.ts` 新增一例：未设时 `cycleAnchorDay` 为 null，PATCH 存 31 后详情与重新读取都返回 31（旧代码上失败）；`node-detail.test.ts` 新增一例：`cycleAnchorDay: 31` 且本期开始于 2026-02-28 时返回 `'31'`，为 null 时退回开始日的日号。fixture（`generate-fixtures.mjs`、`node-detail*.json`、`captured/*/nodes*.json`）补 `cycleAnchorDay`，日期不动；31 日对 2 月 28 日的回归只由单元测试覆盖。
- 部署：随 control-plane 一起部署；控制台先于 control-plane 上线时，缺失该字段会在契约校验处报错，故两者同批。
- 候选/发布：无新包，仅源码。
