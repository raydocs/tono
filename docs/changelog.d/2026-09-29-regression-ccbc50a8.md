## 2026-09-29 · 合并回归审查 ccbc50a8...6f399bac 与候选 7423 自批记录
- 归属：SHIP_PLAN §2 item 10（brick 审计批次）；macOS helper、Windows Service/App/安装器。
- 来源：main `ccbc50a8` → `6f399bac`，含 #677、#679、#681、#680；本条仅记录，不改代码。
- 缺陷修复：无（各 PR 自有条目：`2026-09-28-regression-a1d498c8-minors.md`、`2026-09-29-macos-brick-helper-fixes.md`、`2026-09-29-win-release-min.md`、`2026-09-29-win-boot-uninstall.md`）。
- 新增/优化：无。
- 工程与测试：合并回归审查区间 `ccbc50a8...6f399bac`，jev-route triple（opus + codex + grok，max）run `da18e5d9`，PASSED，0 发现。重点核对 #680 × #681（开机守卫/持有 Core 与 `--start-registered`、死租约准入、`successor_relaunched` 与只读更新准入、合并后的 BRICK-W2）以及 #679 × #677。已登记的 open minor 不重报：BRICK-M13、R681-release-gate-writes、R681-start-only-74-after-acl、R681-old-helper-still-on、R680-dns-child-job-window、R680-dns-marker-doc-stale、R677-codex-F1。
- 验证：以上审查；实机未执行。
- 候选/发布：内部候选 0.0.74 seq 7423（源码 `c0e7758e`，#677）由 Windows release run [36392334212](https://github.com/raydocs/tono/actions/runs/36392334212) 构建，环境审批为 agent 自批（所有者决定 2026-09-28），非客户发布。7423 不含 #679/#680/#681 的修复，已被后续候选取代，不再用于验收。
- 剩余限制：批次内修复均无实机证据；Mac Studio 与 Windows 设备验证待新候选。
