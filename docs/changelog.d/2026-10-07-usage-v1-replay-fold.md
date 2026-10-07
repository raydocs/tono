## 2026-10-07 · 控制面：旧 v1 命名来源重放不再在计数器重置后重记用量
- 归属：SHIP_PLAN §2 item 10（0.0.75 修复批次，所有者 2026-10-07）；`services/control-plane` 用量折叠（`/api/v1/home/usage`）。
- 来源：基线 origin/main `f2cb79522` → 分支 `claude/cp-usage-v1-replay-fold-20261007`，PR 待开；未合 main。
- 缺陷修复：[#816](https://github.com/raydocs/tono/issues/816)。dual 阶段 v1 命名来源先报 900@t1，计数器重置后报 120@t2（累计 1,020），再重放保留的第一份报告时，v1 高计数例外接受其较旧时间戳，再加 780，累计变 1,800。现在折叠的 v1 分支只接收没有被同一账户、同一来源更晚插入（rowid 顺序）的保留报告取代的报告；重放不再进入折叠，累计保持 1,020。
- 新增/优化：无。时钟回拨但确为新报告的 v1 上报仍是该来源最新插入的行，保留原有高计数例外；v2 路径不变；不加 D1 迁移。条件片段 `V1_USAGE_REPORT_NOT_SUPERSEDED` 放在 `src/retention.ts`（报告 ID 保留语义所在），`src/index.ts` 行数不增。
- 工程与测试：新增一个回归 `does not refold a replayed legacy v1 report after a counter reset (#816)`（`test/worker.test.ts`）。
- 验证：本机 `npx vitest run test/worker.test.ts -t 816` 旧代码失败（expected 1800 to be 1020），修复后 `npx vitest run test/worker.test.ts test/index-size.test.ts` 211 通过；`npm run typecheck` 通过。ci-gate 见 PR。
- 候选/发布：无新包，仅源码。
- 剩余限制：报告 ID 超过 14 天被保留清理删除后再重放，会作为新行插入并仍可能触发 v1 例外重记；彻底解决需 v1 来源退役或单调水位，不在本 PR。
