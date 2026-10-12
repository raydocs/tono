## 2026-10-10 · 客户 360 加「这月实际体验」（计划 §4 4.6）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md) §4 第 4 批 4.6（依赖 2.5 的 `GET slo`，已在 main）；[Amp 待办](../ops/amp-backlog-2026-10-10.md) A22。只改 ops 控制台；不改 Worker；不属客户发布门。
- 来源：叠在 4.4 分支 `amp/a22-4-reply-draft`（同改 `CustomerDetail.tsx`）之上；分支 `amp/a22-6-customer-slo`，PR 见本条目所在 PR；未合 main。
- 缺陷修复：无。
- 新增/优化：客户 360「现在」下面新增一节「这月实际体验」（近 30 天）：按这位客户当前节点（`now.node`，没有时取最近上报设备的所选节点）与运营商（`now.carrier` 按 `slo-rollup.ts` 的同一规则归到移动 / 电信 / 联通 / 其他；没有运营商就不过滤）调 `GET slo?range=30d&node=&carrier=`，用 `MetricCard`（`Measured<T>`）显示成功率、连上用时中位数、已验证中断、缺测四个数，上方一行写明对照的是哪个节点和运营商；不知道节点时说明原因，不发请求。新文件 `src/pages/customer/Experience.tsx`、`src/lib/customer-slo.ts`、文案 `src/copy/customer-slo.ts`（在 `copy.ts` 注册）。
- 工程与测试：不写新的单测或 Playwright（计划 §2 规则 5）。
- 验证：Linux orb，Node 24。控制台 `typecheck`、`lint`、`npm test`（45 文件 347 项；首轮被 `copy.test.ts` 的行话检查抓到注释里一个「桶」字，已改）、`build`、`check-budgets` 通过。夹具页 `#/customers/u-04` 用 agent-browser 打开，看到「Los Angeles · Mesa · 移动」与四个数，截图见 PR。未执行：Playwright。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：这是该节点 × 运营商所有客户的每日汇总，不是这一位客户自己的尝试。客户详情页多了一节，`e2e/customers.spec.ts` 的 `detail.png` 截图基线（macOS，夜间 `screenshots-nightly.yml`）需要在 Mac 上重生成，本机做不了。
