## 2026-09-30 · 运维控制台重做第 2 期（二）：节点页与节点详情页
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md) 的一个控制台（Ops 2）工作；只动 `services/ops-console`。
  不是出货门，G4 冻结期间不合入。
- 来源：叠在 #745（`cursor/ops-console-overview-quality-d728`，cf095853）上 → 分支 `cursor/ops-console-nodes-3a37`，
  PR [#746](https://github.com/raydocs/tono/pull/746)；未合 main。合入顺序：#743 → #745 → #746。
- 缺陷修复：
  - 节点页：卡片网格整张卡是按钮、里面又有链接（axe `nested-interactive` 5、`aria-allowed-role` 38），亮色一处对比度不足。
    改成表格后三项都为 0。
  - 节点详情：任务表最后一列表头是空的（`empty-table-header`）；最近连接的横向滚动区键盘进不去
    （`scrollable-region-focusable`）；暗色下选中的筛选小标签对比度 3.3（`color-contrast`）。都已修。
  - 侧栏「这台机器」在 360 px 宽里分两栏，标签一个字一行；侧栏里改成一栏。
- 新增/优化：
  - 节点页改成仪表板：六个头条数字（在役、有问题、在线客户、本周期流量、7 天连接成功率带趋势、本月节点成本）；
    全机队负载四图（CPU、内存、load1 的平均与最忙一台，入 / 出流量合计；24 小时 / 7 天）；
    节点表按健康筛选（带计数）、搜索、生命周期小标签，有问题的排前，行内有 CPU 小趋势、流量额度条、7 天成功率、到期。
    手机上只留状态、节点、流量三列，表在图前。`?node=` 抽屉保留给 ⌘K。
  - 节点详情改成仪表板：六个头条数字（在线客户与容量、7 天成功率带趋势、握手中位、本周期流量带额度色调、
    本月成本与每 GB、到期）；机器负载四图直接展开（CPU、内存、入 / 出流量带 95 分位、并发连接带峰值）；
    连接质量（7 / 30 天，按运营商的每日成功率与每日尝试）；去程 / 回程两块，回程每个运营商带最近的探测条。
  - 数据全部来自现有接口：`/nodes`、`/nodes/:name`、`/slo?node=`、`/ledger/month`、旧版 `metrics`（整队不带 `node`）与 `fleet-nodes`。
    成功率 = Σ成功 ÷ Σ尝试；没测到的格子是断线，不画 0。
  - 保留：路由未改，Ops 1 未下线；`Today.tsx`、`CustomerDetail.tsx`、`copy/customers.ts` 未动。
- 工程与测试：
  - `lib/fleet-load.ts`（整队负载按列求平均 / 最大，流量求和）2 个 `it`；`lib/probes.ts`（探测轮次转通 / 不通 / 未测）1 个 `it`。
  - e2e：重写 `nodes.spec`、`nodes-phone.spec`，更新 `states.spec`、`docs.spec`、`node-detail.spec`（负载不再折叠、新增连接质量）。
    删掉卡片视图不再存在的像素基线。
- 验证（Linux 云端 VM，`services/ops-console`）：`npm run typecheck`、`npm run lint` 通过；vitest 31 个文件 326 个用例通过；
  `npm run build` 初始 JS 197.7 KB gzip / 400，总 302.6 KB / 600，没有超过 400 行的源文件。
  本机 Playwright（系统 Chrome，`--ignore-snapshots`，与 CI 同）：nodes、nodes-phone、node-detail、states、shell、customer-detail 80 个通过。
  axe（wcag2a/aa、wcag21aa、best-practice）在 1440/390、亮/暗下：两页改后都是 0。
- 候选/发布：无新包，仅源码。
- 剩余限制：
  - 没有数据源、这次没画的：节点容量合计（`NodeSummaryDto` 没有容量）、在线人数的历史曲线（只有当前值）、
    成功率目标线、按小时的成功率（`/slo` 只有按天）。
  - 像素基线没有在本机重录（平台相关）；CI 用 `--ignore-snapshots`，需要时在 CI 的镜像里重录。
