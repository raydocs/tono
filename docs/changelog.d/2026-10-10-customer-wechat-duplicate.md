## 2026-10-10 · 客户列表标出重复的微信号（计划 §4 4.3）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md) §4 第 4 批 4.3；[Amp 待办](../ops/amp-backlog-2026-10-10.md) A22。影响控制面 `GET /api/v1/ops/customers` 与 ops 控制台客户列表；不属客户发布门。
- 来源：基线 `origin/main` 2e4a7dfc；分支 `amp/a22-3-wechat-duplicate`，PR 见本条目所在 PR；未合 main。
- 缺陷修复：无。
- 新增/优化：`CustomerSummaryDto` 加可选 `wechatDuplicate?: boolean`（只在为真时出现）。`funnel.ts` 新增 `loadDuplicateWechatKeys`：全量一条读，比较时去首尾空白、不分大小写，算上已注册用户和尚未注册的邀请，所以分页后另一位在别的页也能标出。控制台微信列对重复的行在号下加 `tone-unk` 小标「重复」，悬停说明还登记在另一位客户或邀请名下（文案在 `src/copy/customers.ts`）。`GET customers?q=` 时邮箱或微信号与 `q` 完全相等的行排最前：带 `q` 的游标排序键前加名次 `0`/`1`，无 `q` 的游标格式不变。为给新字段腾行，`LogWindowDto` / `assertLogWindow` 原样移到 `contract/log-windows.ts` 并从 `contract/customers.ts` 再导出。
- 工程与测试：按计划 §2 规则 5（非钱/判定/告警/角色 403 的 Worker 改动不写新测试），不新增测试；`docs/ops/api-contract.md` 部门 B 块加一行。
- 验证：Linux orb，Node 24。控制面 `npm run typecheck`、`check:budgets`、`check:contract` 通过，`npm test` 全量见 PR。一次性（未提交）vitest 手调接口：两位用户微信 `Same_Id` / ` same_id` → 两行 `wechatDuplicate: true`，用户与未注册邀请同号 → 用户行为真；`q=Zed&limit=3` 翻页顺序 `u-2,u-5`（微信号等于 zed）在前、8 行各出现一次；无 `q` 游标用于带 `q` 请求 → 400。控制台 `typecheck`、`lint`、`npm test`（45 文件 347 项）、`build`、`check-budgets` 通过；夹具页（临时改 `customers.json` 两行同号，未提交）截图见 PR。未执行：Playwright（规则 5）。
- 候选/发布：仅源码，无新候选；Worker 未部署。
- 剩余限制：不改夹具与生成器（避免基线重生成），所以 Playwright 夹具里没有重复行。客户详情页不显示该标记。SQL `LOWER` 只折叠 ASCII，非 ASCII 微信号的 `q` 完全相等排序按字节比较（重复判定在 JS 里做，不受影响）。
