## 2026-09-30 · 运维台：配额锚日按 UTC 日读回

- 归属：编排器低风险范围 O1（数据正确性）。不是客户发布门。操作员在表单里看到的锚日会变，标 `ui-review`，不自动合并。
- 来源：基线 `origin/main` `ff81118a`；分支 `cursor/ops-quota-anchor-utc-day-5636`（从云代理 bc-7ab08cd1 的本地提交 `ae89253b7` 恢复）。
- 缺陷修复：`anchorDayOf` 用本地 `getDate()`。计量周期默认按 UTC 午夜起算（`quota.ts` `cycleBounds`）。UTC 午夜在西时区仍是前一天晚上，保存机器资料会把锚日写成前一天。改后用 `getUTCDate()`。
- 新增/优化：无。
- 工程与测试：`node-detail.test.ts` 用 `Date.UTC(2026, 2, 9)` 断言为 9。
- 验证：`TZ=America/Denver npx vitest run src/lib/node-detail.test.ts`。UTC 的 CI 上本地日和 UTC 日重合，这条用例在丹佛时区才能挡住退回 `getDate()`。
- 候选/发布：仅源码，无新候选。
- 剩余限制：周年周期若起点不是 UTC 午夜，读回的仍是该时刻的 UTC 日。
