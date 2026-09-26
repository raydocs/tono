## 2026-09-26 · 账目冲正按当前 UTC 月锁定状态放行（#191）
- 归属：ops 任务（运维计划 §1.3 遗留），非客户发布门；影响 ops-console 设置 › 账目（`lib/ledger.ts`、`pages/settings/Ledger.tsx`、`LedgerTable.tsx`、`copy/ledger.ts`）。
- 来源：基线 origin/main `3470dd68`；分支 `fix/ops-ledger-reversal-warning-20260926`，[PR #647](https://github.com/raydocs/tono/pull/647)；红分支 `wip/ops-ledger-reversal-warning-20260926-red`；未合 main。沿用已关闭 PR #209 的做法，在当前 main 上重做，保留 Batch 8 的 `summaryNonce` / `summaryValid` / 条目就绪判断和样式。
- 缺陷修复：原来锁定当前月后提示「只能冲正，不能改」，冲正按钮仍可点，后端 `postLedgerReverse` 以 `utcMonthString(now())` 为目标月，锁定即 409 MONTH_CLOSED；前端又用本地月当冲正目标，时区边界（如丹佛 9-30 18:00 起已是 UTC 10 月）会显示错的月份。现在：单独读取当前 UTC 月的锁定状态（每次写入后重新读取，旧的「未锁」不再作数）；未读到/读取失败/已锁定时冲正禁用并说明原因；关账对话框区分「这也是当前 UTC 月」与「冲正只能记入未锁定的当前 UTC 月」；对话框跨 UTC 零点时先刷新不写入；读取后才被锁定的，收到 MONTH_CLOSED 时关闭对话框、刷新并提示冲正未写入。后端月份保护不变。
- 新增/优化：无。
- 工程与测试：新增 `reversalMonth` 及 `src/lib/ledger.test.ts` › months › 「posts reversals across the UTC boundary even while Denver is still in September」；e2e `ledger.spec.ts` 已有的锁定用例改为新文案并断言冲正禁用。
- 验证：MacBook 本地 `TZ=America/Denver npx vitest run src/lib/ledger.test.ts` 红分支 1 失败（断言）/ 20 通过，修复后 21 通过（本机时区同样通过）；UTC 时区下红分支骨架不会失败。`tsc --noEmit`、相关文件 eslint 通过。Playwright `e2e/ledger.spec.ts` 本机 28 通过、2 失败（「一笔账都没有的月份」浅/深色截图），红分支（页面代码同 main）同样失败，属本机像素差异，未改基线。
- 候选/发布：仅源码，无新候选；ops-console 未部署。
- 剩余限制：未做浏览器实机截图验收；目标月锁定状态为读取时的快照，最终以后端拒绝为准。
- 续记 2026-09-26（评审 7198f0a8 通过，采纳 minor）：① #191 的发现状态改回总账原行（in-PR），删去重复的分片；② 当前 UTC 月锁定状态读取失败不再永久显示「还没读到」：新增纯判定 `reversalGate`，失败时冲正原因为「读取失败」，并在条目区显示「重读锁定状态」按钮重新读取；测试 `src/lib/ledger.test.ts` › months › 「tells a failed lock read apart from one still loading」；③ UTC 以东时区在本地已进入新月、UTC 仍在上月时锁定新月，关账对话框提示该月 UTC 零点后即为当前 UTC 月、锁定后整月不能接收冲正。验证：本机 vitest 22 通过，`tsc --noEmit`、相关文件 eslint 通过；新测试未做红分支。
