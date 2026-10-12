## 2026-10-12 · 运维台：「在报」那句话说明它为什么比「在役」多
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：基线 `feat/ops-maturity-r1`（c90390bd，叠在其上，合入顺序：先该分支）→ 分支 `feat/ops-reporting-breakdown`；未合 main。
- 缺陷修复：生产节点页上方「在役」写 14，机器负载一栏写「17 台在报」，操作员看不出差在哪。两个数数的不是一个东西：
  在役是节点列表里没退役的行；在报是指标接口窗口里有样本的序列名，该接口不关联目录，所以仍在跑探针的已退役机器、以及不在节点列表里的名字都被算进去。
- 新增/优化：
  - 「N 台在报」后面按需接一句：`，其中 3 台已退役、1 台不在名单`（只写非零的部分），再加 `，K 台没上报`（在役但窗口内没有任何样本的机器）。三项全是零时句子不变。
  - 序列名与节点按完整名字匹配；匹配不上再去掉末尾的 ` · hy2` 比一次。这与控制面 `catalogBaseName`（`services/control-plane/src/catalog-yaml.ts:8`）的规则一致，只认这一个后缀，不把任意的「 · 段」当后缀。
  - 数字仍是等宽字，解释的部分是普通字。节点列表没加载完时不写解释，避免把所有名字都说成「不在名单」。
- 工程与测试：`src/lib/fleet-load.ts` 加 `reportingBreakdown`，`src/lib/fleet-load.test.ts` 四例（精确匹配全为零、hy2 后缀、已退役与不在名单、没上报）；
  `e2e/nodes.spec.ts` 一例：本页内改写指标响应（加一个不在名单的名字、去掉一台在役机器），断言整句。默认 fixture 的指标本来就含它的已退役节点，所以默认截图里这一句会变长。
- 验证（本机，`services/ops-console`）：`npm run -s typecheck`（未检查索引访问 197）、`npx vitest run`（368 通过）、`npx eslint src e2e`、`npm run build`（预算全绿）；
  Playwright `e2e/nodes.spec.ts`、`e2e/nodes-phone.spec.ts` 用本机已有的 headless shell、`--ignore-snapshots` 跑，22 例通过；新例在旧的 `FleetLoad.tsx` 上失败（实际文本只有「42 台在报」）。
  `nodes/dashboard.png` 与 `nodes-phone/nodes.png` 的基线会因这句变长而变，本提交没有重录。
- 候选/发布：无新包，仅源码。
- 剩余限制：控制台只能解释差距，不能消除它：已退役机器上仍在跑的探针需要在机器上停掉，控制台不动它们；未在真实服务端验证。
