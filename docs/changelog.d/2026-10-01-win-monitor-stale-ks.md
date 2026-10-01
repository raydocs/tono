## 2026-10-01 · 健康监视器不再把过期的杀开关快照写回界面
- 归属：SHIP_PLAN §2 item 10（界面把已经收回的隧道许可显示成仍锁定）。Windows App 连接健康监视器。Issue #905。
- 来源：基线 `b341164b` → 分支 `cursor/win-monitor-stale-ks-f0e7`，[#942](https://github.com/raydocs/tono/pull/942)，未合 main。
- 缺陷修复：`network_monitor_loop` 在 DNS 状态和数据面探测之后，把这一拍开始时的杀开关写进应用状态，不看 `snapshot_generation`，也不再核对 `connect_generation`。DIRECT 重载在探测期间把 Service 改成 Blocked 之后，界面仍能显示更早的 Locked 和隧道许可。现在写回前再读一次本地状态：代数没变就用原来的读数，变了就用新的，会话已经结束或第二次读取失败则保持应用里已有的读数。健康腿仍用这一拍开始的快照，不因此放行或收紧 WFP。
- 新增/优化：无。
- 工程与测试：`a_stale_kill_switch_aggregate_is_not_published_after_the_service_moves`。
- 验证：本机 `rustc 1.83.0` 编不过 App crate 的 `edition = "2024"`，未安装更新的工具链，`cargo test` 未跑。由托管 Windows CI 执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：网络事件计数和 Core pid 仍来自这一拍开始的快照。第二次状态读取失败时，这一拍不更新杀开关显示。
