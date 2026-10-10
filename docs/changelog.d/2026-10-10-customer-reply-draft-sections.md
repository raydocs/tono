## 2026-10-10 · 客户回复草稿分三段、可勾选（计划 §4 4.4）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md) §4 第 4 批 4.4；[Amp 待办](../ops/amp-backlog-2026-10-10.md) A22。只改 ops 控制台客户 360 的「回复草稿」；不改 Worker；不属客户发布门。
- 来源：基线 `origin/main` 2e4a7dfc；分支 `amp/a22-4-reply-draft`，PR 见本条目所在 PR；未合 main。
- 缺陷修复：无。
- 新增/优化：草稿由问候加三段组成，每段带小标题，页面上各有一个勾选框，勾掉的段不进文本框和剪贴板（勾选会按字段重新拼草稿，覆盖手改）。「已确认」：最近一次失败的时间与节点、阶段与代码中文解释、运营商（该次上传 Cloudflare 看到的网络；经我们出口上传的不引用，退回「现在」块的运营商）、该节点是否有已登记事故。「待确认」：失败设备的客户端版本与 `releases/channels` 该平台最新稳定版比较（落后 / 已最新 / 没有发布 / 版本未知各一句）、该设备当前所选节点是否已离开失败节点、按代码挑的追问。「建议」：引擎判正常且在目录上的节点，同区（失败节点的 `region`）优先，再按去程最差运营商成功率从高到低，未测的排后，不推荐刚失败的那台。追问文案「上面这个节点」改为「下面建议的节点」；文本框最小高度 168→320 px 以放下三段。逻辑移到 `src/lib/reply-draft.ts`（`lib/customers.ts` 再导出），文案在 `src/copy/followups.ts`。
- 工程与测试：不写新的单测或 Playwright（计划 §2 规则 5）。行为变化迫使更新一处已有 e2e 期望：`e2e/customers-actions.spec.ts` 回复草稿用例的建议节点从 `Tokyo · Fuji` 改为 `Los Angeles · Pacific-Coast-Highway-Backhaul-01`（夹具里 Mesa 无 region，按去程成功率 0.96 选出）。
- 验证：Linux orb，Node 24。控制台 `typecheck`、`lint`、`npm test`（45 文件 347 项）、`build`、`check-budgets` 通过；`src/lib/customers.test.ts` 原有 6 条草稿用例保持绿。夹具页 `#/customers/u-04` 用 agent-browser 打开、点「写一封回信」、勾掉「待确认」，两张截图见 PR。未执行：Playwright（本机无浏览器包，规则 5 也不要求；改过期望的那条由集成者跑）。
- 候选/发布：仅源码，无新候选；未部署。
- 剩余限制：版本比较用 `releases/channels` 的当前稳定版而不是 `releases/adoption` 矩阵；只看失败那台设备。区域只按 `region` 字符串相等，不懂「东京」与「Tokyo」是同一地。
