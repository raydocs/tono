## 2026-10-03 · Windows：线路推荐不再推荐正在反复中断的线路
- 归属：SHIP_PLAN G2（连不上有下一手）；所有者 2026-10-03「按你说的做」第 5 项，叠在 #1370 之上。Windows App 前端（`route-preferences.ts`、`servers.tsx`）。
- 来源：基线 #1370 的分支头 → 分支 `fix/win-recommend-avoids-unstable-route-20261003`；尚未合入 main。
- 缺陷修复：线路页的「推荐线路」只看 24 小时内成功过和 TCP 可达，会把刚被标为不稳定的当前线路排在第一位。现在 `routeUnstableUntilMs` 未到期时推荐跳过它，给出下一条有新鲜证据的线路（WIN-UNSTABLE-ROUTE-NO-HINT 的续）。
- 新增/优化：无。推荐仍然只在未连接时可用、只做选择，不连接、不热切换（决策 054）。
- 工程与测试修正：回归 `does not propose the route that keeps dropping, even though it verified recently`（vitest）先单独提交为红（`ab90303a`），本机 `1 failed | 2 passed`：`expected { name: 'Buffalo · Niagara', … } to match object { name: 'Tokyo · Dawn', reason: 'tcp' }`。红提交在 CI 上会先停在类型检查（多传一个参数），所以红证据是本机输出。
- 验证：本机 `vitest run route-preferences.test.ts servers.test.tsx` 19 通过，`tsc --noEmit`、eslint 通过。没有实机验证。仅源码，无新候选。
- Merged: #1371, merge commit `75f2f12f`, PR head `fada46d1`, after its base #1370 (`acb9bafd`) merged and the PR was retargeted to main. ci-gate green on that head: run 37149529459 (`windows / app`, `app-rust`, `core`, `service` success). The red evidence stays the local output above; no CI red is claimed.
- Source only: not in the `66a5bc5c` candidates. No hardware run.
