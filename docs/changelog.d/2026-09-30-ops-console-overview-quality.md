## 2026-09-30 · 运维控制台重做第 2 期（一）：概览与连接质量
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md) 的一个控制台（Ops 2）工作；只动 `services/ops-console`。
  不是出货门，G4 冻结期间不合入。
- 来源：叠在 #743（`cursor/ops-console-foundation-d728`）上 → 分支 `cursor/ops-console-overview-quality-d728`；未合 main。
  合入顺序：#743 → 本 PR → 节点页 PR。
- 缺陷修复：
  - 今天页事故行本身是 `role=button`、里面又放了认领/处理按钮（axe `nested-interactive`）。改为整行仍可点、键盘走标题按钮。
  - ⌘K 面板的读屏标题渲染在对话框外，面板关着时也留在页面里、不属于任何地标（axe `region`，每页都有）。移进对话框内容里。
- 新增/优化：
  - 今天页（概览）改成仪表板：结论卡 + 四个数字卡（`StatTile`，只有需要处理的色调给数字上色，今日到期为 0 时不再显示紫色）。
  - 下面新增「连接质量」一段，数据来自现有 `GET /api/v1/ops/slo`（7/30 天切换）：
    - 五个头条数字：成功率带每日趋势、尝试次数、握手中位、已证实中断、有效测得。
    - 每日成功率折线（全部 + 按平台）、每日尝试次数（按运营商叠加）、每日已证实中断（按整小时刻度）。
    - 最差的五个节点：成功率、每日趋势、尝试、握手中位、中断，可跳节点页。
  - 同一次读取失败或为空时只显示一块，不重复四遍。
  - `lib/slo.ts` 把每日行折成图表数据：成功率 = Σ成功 ÷ Σ尝试（不平均比率）；中断与缺测按"节点 × 天"只算一次，
    与 Worker `handlers/slo.ts` 的汇总口径一致；某天没尝试就是断线，不画成 0 % 或 100 %。
  - `lib/display.ts` 新增 `formatRate`（一位小数）、`formatMinutes`（超过三小时改用小时）、`formatDay`、`formatTally`。
  - 开发用 fixture：`/slo` 从 3 行改为按 `range`/`node`/`platform`/`carrier` 生成 30 天 × 6 节点 × 2 平台 × 3 运营商，
    汇总算法照抄 Worker；页面代码只调真实接口。
  - 保留：`Today.tsx` 未改（#734 在改它），路由未改，Ops 1 未下线。
- 工程与测试：`src/lib/slo.test.ts` 4 个 `it`（加权成功率、缺天是断线、中断按节点日去重、最差排前）。
- 验证（Linux 云端 VM，`services/ops-console`）：`npm run typecheck`、`npm run lint` 通过；vitest 29 个文件 325 个用例通过；
  `npm run build` 初始 JS 196.9 KB gzip / 400，总 297.8 KB / 600。axe（wcag2a/aa、wcag21aa、best-practice）在 1440/390、
  亮/暗下：改前 `aria-required-parent` 3、`nested-interactive` 2、`region` 1；改后只剩 `aria-required-parent` 3。
  未执行：本机 Playwright（VM 未装它自带的浏览器）。
- 候选/发布：无新包，仅源码。
- 剩余限制：
  - 剩下的 `aria-required-parent` 来自 `Today.tsx` 的标签页缺 `role="tablist"`，要等 #734 合入后再改一行。
  - 没有数据源、这次没画的：成功率目标线（代码和文档都没定义目标）、按天的握手 p95、按小时的成功率（`/slo` 只有按天）、
    失败码分布（归 #707/#734）。
- 续记（2026-09-30，接手的代理）：本 PR 的 CI `ops-console-e2e` 红在两处，都是本 PR 引入的，已修：
  - `ledger.spec`「毛利算不出来的」：新的 `/slo` fixture 让账目页出现很多条 `Seoul · Han` 链接，断言改为取第一条。
  - `today-phone.spec`：连接质量挂在头条区里，在手机上把事故和「认领」挤出第一屏。手机上先不挂这一段；
    等 #734 合入、`Today.tsx` 能把它放到事故列表下面时再放回手机。
  - 本机 Playwright（系统 Chrome，`--ignore-snapshots`，一个 worker）：`ledger`、`today-phone` 35 个通过；
    `一个月的账，一页` 的整页截图在本机 Chrome 里截不出来（页面太长），CI 上通过。
