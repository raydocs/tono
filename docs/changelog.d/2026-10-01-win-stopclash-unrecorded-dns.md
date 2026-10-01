## 2026-10-01 · StopClash 记账失败后不再把 DNS 留在已死的解析器上
- 归属：SHIP_PLAN §2 item 10（装上会坏：确认停止后的记账失败把解析留在无人应答的 198.18.0.2）。Windows Service `StopClash`。无对应 Issue。
- 来源：基线 `71bd69d8` → 分支 `cursor/win-stopclash-unrecorded-dns-f0e7`，[#930](https://github.com/raydocs/tono/pull/930)，未合 main。
- 缺陷修复：Core 已确认停止后 `persist_owner_core_stopped` 失败时，处理函数在 `transition_after_stop` 之前返回，保护 DNS 仍指向已死的解析器，WFP 保持武装。现在 `recover_after_unrecorded_stop` 接上这一失败：`release_kill_switch` 为真时走与成功停止相同的过渡（先恢复 DNS，再放下非严格屏障）；为假时按仍有效的运行意图把 Core 拉起来，拉不起来则恢复 DNS 并保留屏障，不把仍保持的会话整网放开。成功路径不变。恢复失败才把生命周期标成 Fatal。
- 新增/优化：无。
- 工程与测试：`an_unrecorded_stop_restores_dns_without_dropping_the_barrier`、`an_unrecorded_release_restores_dns_and_drops_the_non_strict_barrier`。
- 验证：本机 `rustc 1.83.0` 编不过 `edition = "2024"`，未安装更新的工具链，`cargo test` 未跑。由托管 `windows-2025` CI 执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：记账失败本身没有被重试，磁盘上的运行意图仍是「Core 应该在跑」。启动侧已有「没有恢复出 wanted 屏障就不重放运行意图」的门，所以释放之后的下一次启动不会把 Core 拉进已打开的网络。保持会话的路径在重启失败后保留当时的 WFP，不另加一层 AI 窄规则。
