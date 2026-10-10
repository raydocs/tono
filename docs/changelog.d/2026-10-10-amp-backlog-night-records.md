## 2026-10-10 · Amp backlog 夜间会话收尾记录（发现状态、评审遗留、执行状态表）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，[Amp backlog 2026-10-10](../ops/amp-backlog-2026-10-10.md)；仅文档
  （`docs/FINDINGS_LEDGER.md`、`docs/findings.d/`、`docs/ops/amp-backlog-2026-10-10.md`）。
- 来源：基线 origin/main `d3e282ef`（#1491 合入；#1510 在其之前合入）；分支 `amp/records-backlog-20261010`。不改代码。
- 缺陷修复：无代码改动。修复 PR 已合 main 的 8 条 `in-PR` 改为 `fixed(<合并提交>)`，「剩余限制」写「待实机」和缺的证据：
  - 总账行：R3-O5（`2453dec5`，#1473）、H21-O-F7（`beb871d1`，#1480）、H21-O-F8（`44dcb4fe`，#1488）、H17-C-F1（`9bc77231`，#1487，
    补「调高上限也会踢遗留超额账户」指向新条目 A9-RAISE-EVICTS-OVERCAP）。
  - 分片：OPS-TIMELINE-CONNECT-CANCEL-KIND（`d12e2f9f`，#1503）、A24-PAIR-STALE-WINDOWS-ARTIFACT（`c3beed2b`，#1505）、
    WIN-HEAL-UNGATED-HY2-HOP（`a74bdc59`，#1500）、OPS-ALERT-RESOLVE-SUPPRESSED（`554e454d`，#1510）。
  - 未动：D7（#1506 草稿）、R3-O4（#1504 草稿）、H1-F5（#1507 评审中）。
  - 新增 10 条 `open` 分片，来自已合 PR 用完一轮 minor 修复后的评审遗留，来源写 PR 和评审回执评论链接：
    A17W-REVOKE-BEFORE-START、A17W-MANUAL-RESELECT-RACE、A17W-ARMED-REUSE-EXPIRY、A17W-FALLBACK-SNAPSHOT（#1500，仅 `hy2AutoSwitch` 开时）、
    A17M-RESTORE-PROMOTES-AUTO（#1499）、A9-RAISE-EVICTS-OVERCAP（#1487）、A18-AUDIT-STALE-WAS（#1492）、
    A4-STARTUP-CACHE-OVERWRITE、A4-UPDATER-REVISION（#1498），均 低；MAC-EMERGENCY-UNBOUNDED-WAITS（#1504 草稿评审 R3，main 上已有，
    评审定 major，按总账等级记 高·推导，与 MAC-EMERGENCY-STALE-CORE 同档）。
- 新增/优化：backlog 加 §9 执行状态表（A1–A32：已合 PR、草稿等所有者、已在 main、阻塞原因）。
- 工程与测试：ops-console e2e `e2e/ledger.spec.ts:155` 偶发失败一次（ci-gate run 38056004583 第 1 次尝试，#1511），重跑通过；
  按总账规则不进发现账，记在 backlog §9。
- 评审区间做法：Codex 评审额度用完、OpenRouter 额度用完、Grok 线程报错后，本夜高风险与评审回执改由 GPT-6 Astra（high）在
  独立 Amp 线程里做，每份回执在 PR 评论里写覆盖 SHA、结论、发现与清单；一轮 minor 修复后仍开的 minor 记成上面的分片，
  major 不合（#1504、#1506 转草稿）。
- 验证：`node tooling/scripts/records.mjs findings` 改前改后都能解析；`--status in-PR` 8 → 0；
  `node --test tooling/scripts/tests/records.test.mjs` 改前改后 3/3 通过。产品测试不适用（仅文档）。
- 候选/发布：仅文档，无新候选；无部署。
- 剩余限制：标为 fixed 的 8 条均未实机、控制面均未部署；新分片均为读码推导或一次性复现，没有修复 PR。
