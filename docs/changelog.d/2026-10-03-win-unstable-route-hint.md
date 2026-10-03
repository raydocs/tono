## 2026-10-03 · Windows：线路反复中断时提示换线路
- 归属：SHIP_PLAN G2（连不上有下一手）；所有者 2026-10-03「按你说的做」第 5 项。Windows App（`state.rs`、`commands/mod.rs`、`connection/monitor.rs`、首页 `dashboard.tsx`）。
- 来源：基线 `bb7317c6` → 分支 `feat/win-unstable-route-hint-20261003`；尚未合入 main。
- 缺陷修复：已连接的线路在半小时内中断 3 次（数据面探测失败，60 秒内的接连失败算一次）时，首页显示「这条线路最近半小时内多次中断，换一条线路可能更稳定。」和「切换节点」按钮。之前界面每次恢复后都回到「已连接」，没有任何提示（WIN-UNSTABLE-ROUTE-NO-HINT；现场一位用户在同一条线路上连续 9 天每天 7–30 次探测失败）。
- 新增/优化：`TonoStatus.routeUnstableUntilMs`。只提示，不自动切换，不改探测、重连、放开和 WFP（决策 054）。记录只在进程内存里。
- 工程与测试修正：回归 `a_route_that_keeps_dropping_is_reported_unstable`（Rust）先单独推送为 `fad7de97`（红），运行见 PR；首页用例 `offers another route when the connected route keeps dropping`（vitest）本地先红后绿。`periodic_data_plane_probe_failed` 和 `in_place_hold_still_proven` 多一个 `AppHandle` 参数，用于在线路变为不稳定时发布一次状态。
- 验证：本机 `vitest run src/pages/tono/dashboard.test.tsx` 26 通过，`tsc --noEmit`、eslint、typecheck 棘轮（79/79）通过；Rust 只有托管 CI（本机不跑 cargo）。没有 Windows 实机验证（needs-hardware）。仅源码，无新候选。
- 剩余限制：线路页的推荐仍可能推荐这条线路，另开 PR；macOS 没有对应提示。
