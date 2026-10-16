## 2026-10-12 · 运维台：客户到期缺口提示与批量设到期日
- 归属：ops 计划（[plan-2026-09-11](../ops/plan-2026-09-11.md)）；`services/ops-console`，仅前端，无服务端改动。
- 来源：基线 `feat/ops-node-facts-batch`（叠在其上，合入顺序：先合它）→ 分支 `feat/ops-customer-expiry-batch`；未合 main。
- 缺陷修复：生产 22 位客户的「到期」列全是「— 画像」，因为 `users.expires_at` 只有运维台能写，而没有人录过；「服务使用」列全是「— 上报」，实际原因是客户端没开日志上传（服务端 `service_usage_daily` 只由 `POST /api/v1/diagnostics/logs` 写入），运维填不了，占位却像在说「等上报」。
- 新增/优化：
  - 客户列表：当前列表里在用（`lifecycle` 为 active，不含已停用、已到期）且没有到期日的客户，在表格上方显示「N 位客户没登记到期」和「批量设置到期」（复用 `DataGapBanner`）。点击会选中这些客户并打开设到期日对话框。
  - 批量动作条新增「批量设到期日」：选一个日期，选中的每位客户各发一次 `PATCH users/{id} {expiresAt}`，沿用现有批量的确认、逐人结果、只重试明确失败项；与续 30 天一样先读回确认原到期没变、写后再读回核对。结果行是现有的「已核对 N · 待回执 · 明确失败 · 结果未知」。
  - 批量只接受今天之后的日期：过去的日期会让选中客户的设备几分钟内被撤销，而批量没有逐人先看一眼的机会（单人「改到期」抽屉不受此限）。
  - 占位说明：「服务使用」为空时悬停/无障碍名称改成「客户端没开日志上传，所以没有服务使用」；「到期」为空时改成「还没登记到期日 · 批量设置到期在表上方」。可见的「—」不变。`Value` 新增可选 `reason`，给了就替换默认的「没有数据 · 来源 X」。
- 工程与测试：`src/lib/customer-facts.ts`（缺口计数、绝对日期 patch 构造）加 vitest；`customer-batch.test.ts` 加两例（一个日期写给每位并读回、没有日期不启动）。`e2e/customers-actions.spec.ts` 一例，`e2e/pages-phone.spec.ts` 一例（动作 ≥ 44 px 且在视口内）。
  fixture 里没有任何客户的到期为空，所以两例都先用 fixture 服务器自己的 `PATCH users/{id}` 把几位的到期清空（各自独立 session），再打开页面；默认 fixture 页面不出现横幅，`customers.spec.ts` 的截图和表格列宽不受影响。
- 验证（本机，`services/ops-console`）：`npm run -s typecheck`、`npx vitest run`、`npx eslint src e2e` 见交付报告；Playwright 未安装，e2e 未执行。截图基线无需重录（默认 fixture 页面无变化）。
- 候选/发布：无新包，仅源码。
- 剩余限制：数据仍需操作员录入，不能声称生产已登记；横幅按当前列表（含筛选/搜索后可见的客户）计数，所以筛选后点击只选中可见的那些；服务使用要等客户开日志上传，运维台无法代填。
