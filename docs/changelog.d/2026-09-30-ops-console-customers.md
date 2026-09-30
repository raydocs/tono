## 2026-09-30 · 运维控制台重做第 2 期（四）：客户列表与客户详情
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md) 的一个控制台（Ops 2）工作；只动 `services/ops-console`。
  不是出货门，G4 冻结期间不合入。
- 来源：叠在 #747（`cursor/ops-console-residential-3a37`）上 → 分支 `cursor/ops-console-customers-3a37`；未合 main。
  合入顺序：#743 → #745 → #746 → #747 → 本 PR。
- 缺陷修复：
  - 客户列表：`withInvites` 给每一列都套了排序，连勾选列也变成一个没有文字的排序按钮（axe `button-name`），
    勾选列表头又是空的（`empty-table-header`）；现在只有本来能排序的列才排序，勾选列表头给读屏器读。
  - 客户详情：流量去向最后一列表头是空的（`empty-table-header`）；按运营商的路径在手机上横向滚动区键盘进不去
    （`scrollable-region-focusable`）。都已修。
  - 客户详情：一周的连接时间线整段展开，把整页撑长；现在每天可折叠，默认只展开最近两天。
    u-04 整页高度 1440 宽下 6554 → 3776 px，390 宽下 8112 → 5333 px。
- 新增/优化：
  - 客户列表改成仪表板：六个头条数字（现在在线、7 天内来过、24 小时有失败、本期流量、额度快用完、7 天内到期），
    到期分布（在用客户按到期周，已过期的在最左）和流量最多（对着额度的比例条，点名字进客户页）。手机上表在前、仪表板在后。
  - 客户详情：时间线上方加按天的成功 / 失败柱图（节点详情用同一个时间线，一起有）；流量去向先列前 12 个，
    每行带占比条；页面放宽到 1280 px，时间线八列不再被裁。
  - 数据全部来自现有接口：客户列表（shell 已经读的那一份）与客户详情原有的几次读，没有新增请求。
    没计量的客户不算进流量，也不画 0；停用与过期的账号不算进头条数字。
  - 保留：路由未改，Ops 1 未下线；`pages/CustomerDetail.tsx`（#734）、`pages/diagnostics/*`、`Today.tsx`、
    `copy/customers.ts` 与 `lib/codes.ts`（#707）未动。
- 工程与测试：`lib/customer-board.ts`（头条数字、到期分周、流量排行）2 个 `it`。
- 验证（Linux 云端 VM，`services/ops-console`）：`npm run typecheck`、`npm run lint` 通过；vitest 33 个文件 331 个用例通过；
  `npm run build` 初始 JS 198.8 KB gzip / 400，总 309.4 KB / 600，没有超过 400 行的源文件。
  本机 Playwright（系统 Chrome，`--ignore-snapshots`，与 CI 同）：customers、customers-actions、node-detail、docs、clients、states、shell
  167 个通过；ledger、today、today-phone 79 个通过，1 个是本机 Chrome 截超长整页时崩溃（CI 上通过）。
  axe 在 1440/390、亮/暗下：客户列表、客户详情、节点详情都是 0。
- 候选/发布：无新包，仅源码。
- 剩余限制：
  - 客户详情的页头和"现在"一块在 `CustomerDetail.tsx` 里，那是 #734 的文件，这次没动；客户详情没有自己的头条数字行，
    等 #734 合入后再加。
  - 没有数据源、这次没画的：在线人数的历史曲线（列表只有当前值）、按天的全体流量（列表只有本期合计）。
