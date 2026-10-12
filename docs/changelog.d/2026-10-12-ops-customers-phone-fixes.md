## 2026-10-12 · 运维台：客户页手机上不再有行尾孤点，桌面上节点和最近失败不再被截断
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：基于 `origin/main`（396331705）→ 分支 `feat/ops-customers-phone-fixes`；未合 main。
- 缺陷修复（生产 22 位客户，2026-10-12 成熟度发布后的观察）：
  - 手机（390 px）：客户页顶部「22 位客户 · 2 位正常 ·」行尾挂着一个「·」，下一行才是「0 位连不上」；开通漏斗那一句同样。现在每一段是一个不可拆的块，圆点放在它后面那一段的开头，只会在圆点前换行，不会停在行尾（`DotSegment`）。
  - 手机：节点页「全部节点」副标题「问题在前；点一行去节点页」把最后一个「页」单独挤到下一行。现在按「；」分句，每句不拆（`Clauses`），文字内容不变；`Panel` 的 `description` 因此可以收 `ReactNode`。
  - 桌面（1440–1600 px）：客户表「当前节点」只剩「Los Angeles ·」，站点被截掉；「最近失败」只剩「12 小…」和「TONO_S…」。现在「当前节点」按 `splitNodeName` 分成城市和站点两行，可折行、不用省略号，全名在 `title`；「最近失败」第一行是多久以前，第二行是错误代码对应的中文句子（`copy.codeWord`），没有对应句子的代码原样显示并折行，原始代码在 `title`。
- 新增/优化：「当前节点」列 108→112 px，「最近失败」列 80→92 px（内边距收到 8 px），「微信」列 80→74 px，合计比原来多 10 px，正好用掉「客户」列原先多出的 10 px；1440 px 下「客户」列仍是 260 px，不截地址。1280 px 视口的表格容器只有 968 px，低于 1100 px 的表格下限，本来就横向滚动，未改。节点或失败格折成两行时那一行高于 36 px，其余行仍是 36 px。
- 工程与测试：`src/pages/customer/location-cells.test.tsx` 三例（节点分行与 title、已知代码读作中文并带原始 title、未知代码原样）；`e2e/customers.spec.ts` 一例（dense 夹具下节点和失败格不被截断、节点不以「·」结尾、失败格是中文句子不含原始代码），`e2e/pages-phone.spec.ts` 一例（客户页两句计数不以「·」结尾）、`e2e/nodes-phone.spec.ts` 一例（「点一行去节点页」同在一行），`e2e/ops.ts` 加两个量行的辅助函数；`customers.spec.ts` 与 `states.spec.ts` 里「第一行高 36 px」改为「最矮的一行是 36 px」。
- 验证（本机，`services/ops-console`）：typecheck、vitest、eslint、build、Playwright（customers、nodes、states-phone、pages-phone、states，`--ignore-snapshots`）结果见交付报告。
  会变的截图基线（本提交没有重录，需要在 CI 里重录）：`customers/table.png`、`states/customers-dense.png`、`pages-phone/customers.png`（light 与 dark 各一张）；`nodes-phone/nodes.png` 与 `nodes/*.png` 里的节点列表副标题若换行位置不同也会变。
- 候选/发布：无新包，仅源码。
- 剩余限制：质量页「最差的节点」副标题（`copy/quality.ts` 的 `nodesLead`）有同样的「；」分句，本提交未改；视口 1280 px 时客户表仍需横向滚动。
