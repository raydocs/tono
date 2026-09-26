## 2026-09-26 · exit-agent：空名册且无库存时仍计入已确认的 legacy 撤除（#638 续修）
- 归属：ops 任务（出口计量与吊销）；Issue #600，#638（TF-opus-6）续修。exit-agent `reconcile_and_report.py`。
  合并回归审查（区间 `f2e24512...fb5e8485`，jev-route run `4459fadd`）codex:F4，登记为 CR4459-codex-F4。
- 来源：基线 origin/main `fb5e8485`；红分支 `wip/exit-agent-legacy-count-20260926-red`（`dfdf764c`，只含测试），修复分支
  `fix/exit-agent-legacy-count-20260926`（修复 `2c99e8b1`），[#641](https://github.com/raydocs/tono/pull/641)；未合 main。
- 缺陷修复（仅日志）：无实时列表且要求退役时，`reconcile` 先撤除 `shared-legacy` 并在 Xray 确认后计入 `removed`；
  若名册也为空、且没有记录的库存，随后的保守提前返回固定返回 `(0, 0, None)`，丢掉已确认的计数，本轮日志报 `-0`。
  改后该提前返回带上已有的 `removed`，除此之外仍不撤除任何客户端。停用撤除总传入非空候选集，不走这条返回。
- 新增/优化：无。
- 工程与测试：exit-agent 一条 `test_an_early_shared_legacy_removal_is_counted_with_no_inventory`（修复前 `0 != 1`）。
- 验证：本机（MacBook，仅 Python）：红分支 `python3 -m pytest -q ... -k early_shared_legacy` 1 failed（`0 != 1`）、2 passed；
  修复分支 `python3 services/exit-agent/test_reconcile_and_report.py`（CI 同命令）97 OK。未在任何节点运行，未部署。
- 候选/发布：仅源码，无新候选。
- 剩余限制：**需部署全部节点的 exit-agent 才生效（本 PR 未部署）**。只影响计数与日志，撤除动作本身不变。
- 续记 2026-09-26：#641 已合 main（merge 50c2c0d0）。13 个装 agent 的节点 `reconcile_and_report.py` 换为 main@50c2c0d0 版本（md5 ffe030b1…），逐台备份到 `/root/tono-exit-agent-backup-20260926b/`，替换后首轮均 `result=success`（13/13）。Tokyo·Sakura（148.135.183.152）SSH 超时未部署；其余 7 台主机未装 agent。
