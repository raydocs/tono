## 2026-10-12 · 运维台：客户页手机上的计数句没有行首行尾的「·」，桌面上节点、最近失败、服务使用都是单行加省略号
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：基于 `origin/main`（396331705）→ 分支 `feat/ops-customers-phone-fixes`；未合 main。
- 缺陷修复（生产 22 位客户，2026-10-12 成熟度发布后的观察）：
  - 手机（390 px）：客户页顶部「22 位客户 · 2 位正常 ·」行尾挂着一个「·」；上一版把圆点挪到下一行行首，同样违反中文排版。现在 `DotJoined`（`DotSegment` 并入）在 ≤640 px 把各段排成可换行的 flex（行距 2 px、段距 12 px），每段不换行，所有「·」`display:none` 且 `aria-hidden`，用间距代替圆点；桌面上圆点是各自的 span，左右各 `.35em` 外边距，文本里没有空格。顶部客户数「22 位客户」是标题，和「开通」按钮同一行（按钮在右），「2 位正常 · 0 位连不上 · …」是它下面一行，不再留出一条空带。开通漏斗那一句同样走 `DotJoined`，各段是按钮。
  - 手机：节点页「全部节点」副标题「问题在前；点一行去节点页」把最后一个「页」单独挤到下一行。现在按「；」分句，每句不拆（`Clauses`），文字内容不变；`Panel` 的 `description` 因此可以收 `ReactNode`。
  - 桌面（1440–1600 px）：客户表「当前节点」只剩「Los Angeles ·」，站点被截掉；「最近失败」只剩「12 小…」和「TONO_S…」。现在「当前节点」按 `splitNodeName` 分成城市和站点两行，「最近失败」第一行是多久以前、第二行是错误代码对应的中文句子（`copy.codeWord`，没有句子的代码原样显示）；每一行都是单行，放不下的以省略号结尾（`white-space:nowrap`），全名在 `title`（节点全名；失败格是原始代码，句子在句子行自己的 `title`），所以每一行都是 36 px，不再被撑高。「服务使用」第一个服务名不再被截（`Claude · Ge… +2`，不再是 `Clau… +2`），只有第二个名字用省略号。
- 新增/优化：1440 px 下各列宽度重新分配（总宽 1128 px 不变，无横向滚动）：「最近失败」92→114 px，「服务使用」80→92 px（内边距收到 8 px），「状态」94→86 px，「微信」80→66 px，「跟进」88→84 px，「本期流量」86→78 px（内边距 8 px），「最低版本」76→70 px（内边距 8 px），「当前节点」108→112 px；「客户」列仍是 260 px，不截地址，「到期」仍是 92 px（日期正好占满）。最长的失败句子「客户端手里的节点单子太旧」（141 px）仍放不下，以省略号结尾，全文在 `title`；1280 px 视口的表格容器只有 968 px，低于 1100 px 的表格下限，本来就横向滚动，未改。
- 工程与测试：`src/components/ops/DotJoined.test.tsx`（分隔符是 `aria-hidden` 的独立 span、手机宽度下隐藏、间距靠外边距、段是整块、段可以是按钮），`location-cells.test.tsx`（节点和失败句子是单行省略号，句子行带 `title`）；`e2e/pages-phone.spec.ts` 客户页一例（顶部和漏斗没有任何一行以「·」开头或结尾，圆点不可见，客户数与「开通」同一行、状态行在下面）、clients 页顶部断言改成三段分开；`e2e/customers.spec.ts` 前 8 行（实际是全部行）都是 36 px，dense 夹具下「当前节点」「最近失败」「服务使用」除了自己的省略号 span 外不被截，第一个服务名完整；`e2e/states.spec.ts` 的行高断言改为没有一行不是 36 px；`e2e/ops.ts` 加 `linesStartingInDot`。
- 验证（本机，`services/ops-console`）：typecheck、vitest、eslint、build、Playwright（customers、nodes、today-phone、pages-phone、clients、states，`--ignore-snapshots`）结果见交付报告。
  会变的截图基线（本提交没有重录，需要在 CI 里重录）：`customers/table.png`、`states/customers-dense.png`、`pages-phone/customers.png`、`today-phone`、`clients` 与 `clients-phone` 里计数句的截图（light 与 dark 各一张）；`nodes-phone/nodes.png` 与 `nodes/*.png` 里的节点列表副标题若换行位置不同也会变。
- 候选/发布：无新包，仅源码。
- 剩余限制：质量页「最差的节点」副标题（`copy/quality.ts` 的 `nodesLead`）有同样的「；」分句，本提交未改；视口 1280 px 时客户表仍需横向滚动。复制含「·」的计数句时，文本里的圆点两侧不再有空格。
