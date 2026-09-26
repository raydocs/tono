## 2026-09-26 · exit-agent/控制面：停用节点轮换令牌后仍能撤除；停用日志写明停启 Xray；legacy 撤除计数
- 归属：ops 任务（出口计量与吊销，#563 合并车审查后续）；Issue #600 的 TF-opus-3/5/6/7（TF-opus-4/8 已由 #624 修复）。
  控制面 `ops/shared-admin/exit-nodes.ts`；exit-agent `reconcile_and_report.py` 与 README。
- 来源：基线 origin/main `8b5f6fcd`；红分支 `wip/exit-agent-train-followups-20260926-red`（`d8ddebb1`，只含测试），修复分支
  `fix/exit-agent-train-followups-20260926`（修复 `a56cb932`），[#638](https://github.com/raydocs/tono/pull/638)；未合 main。
- 缺陷修复：TF-opus-5：ops 控制台 PATCH 停用节点只改状态，之后轮换令牌会覆盖 `token_hash`，节点上 agent 持有的旧令牌既不匹配
  `token_hash` 也不匹配 `revoked_token_hash`，得到 401，按「其他错误」保留旧名册、不撤除。改后：active→disabled 时在同一条
  UPDATE 里把当前 `token_hash` 存进 `revoked_token_hash`（退役路径 `revokeExitToken` 原本就这样做），轮换不碰它，停用期间多次轮换后
  旧令牌仍得到 403 `EXIT_NODE_DISABLED` 并撤除。该哈希只在 `status = 'disabled'` 时被查，不认证任何请求；重新启用后旧令牌仍是 401。
  TF-opus-3：按 Issue 定为流程修复：停用轮（成功与撤除失败两条路径）的拒绝说明写明「立即停 `tono-xray`，重新启用时再启动
  （重启才从静态配置恢复 `shared-legacy`）」，README 同步。
  TF-opus-6（仅日志）：无实时列表且要求退役时提前撤除 `shared-legacy`（停用撤除总走这条），Xray 确认撤除（`rmu` 输出
  `Removed N user(s)`、`removeuser` 退出 0）时计入 `removed`；原本不存在（not found）的不计，避免无列表的 Xray 每轮都报 `-1`。
- 新增/优化：无。
- 工程与测试：Worker 一条 `it`：`keeps telling a disabled exit node to withdraw after its token is rotated`（修复前 `expected 401 to be 403`）。
  exit-agent 三条：`test_an_early_shared_legacy_removal_is_counted`（修复前 `1 != 2`）；
  `test_the_disabled_round_tells_the_operator_to_stop_xray_until_re_enabled`（修复前说明里没有停启步骤）；
  `test_a_failed_early_shared_legacy_removal_still_revokes_the_rest`（TF-opus-7 缺口，修复前后都通过，属补覆盖）。
  TF-opus-7 其余两种情形（停用 + 状态文件损坏、不可达 + 状态文件损坏）本 PR 未改行为，未补测试。
- 验证：本机（MacBook，仅 Node/Python）：红分支 `npx vitest run test/worker.test.ts -t "keeps telling a disabled exit node"`
  1 failed（401≠403）；`python3 -m pytest -q -k ...` 2 failed（上述两条）、1 passed（缺口测试）。修复分支
  `npx vitest run test/worker.test.ts` 196 passed；`python3 services/exit-agent/test_reconcile_and_report.py`（CI 同命令）96 OK。
  未在任何节点运行，未部署。
- 候选/发布：仅源码，无新候选。
- 剩余限制：**需部署 Worker 与全部节点的 exit-agent 才生效（本 PR 未部署）**。本改动部署前已停用、且停用期间再轮换令牌的节点
  没有存档哈希，仍会得到 401；退役节点（`revokeExitToken`）原本已覆盖。重新启用后 `revoked_token_hash` 保留旧值，启用期间不被读取，
  下次停用时覆盖。TF-opus-3 只改日志与文档，agent 不自动停启 Xray。
- 续记 2026-09-26：#638 已合 main（merge 779b4876）。控制面与 admin Worker 从 main@57c1c64c 部署（含 `revoked_token_hash`，部署前未导出 D1）；13 个装 agent 的节点 exit-agent 换为 main@#638 版本（md5 b50edcbe…），后又换为 #641 版本（见该条目）；Tokyo·Sakura（148.135.183.152）SSH 超时未部署，「全部节点」的生效条件尚未满足。
