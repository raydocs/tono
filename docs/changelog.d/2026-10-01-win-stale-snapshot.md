## 2026-10-01 · Windows 健康监视不再发布过期的 kill switch 快照
- 归属：SHIP_PLAN §2 item 10；Windows App `monitor.rs`，发现 WIN-MONITOR-STALE-SNAPSHOT。
- 来源：基线 `a864a9ca` → `04f77444`；PR #937；Fixes #905；未合 main。
- 缺陷修复：已连接监视先读 Service 快照，再 await DNS 与最长 18 秒的 TUN 探测，然后把探测前的 kill switch 写入应用状态。DIRECT 热切换不推进 `connect_generation`，界面可以在 Service 已经 Blocked 时仍显示 Locked。现在探测之后再读一次：`snapshot_generation` 变了就丢掉这一拍；没变就发布这一次读取，不再写回探测前的样本。断连则在发布前返回。
- 新增/优化：无。
- 工程与测试：`a_kill_switch_sample_is_not_published_after_the_service_generation_moves` 覆盖代际相等才允许发布。
- 验证：本机 rustc 1.83 不能编译 edition 2024 / rust-version 1.98，`cargo test` 未执行。由 Windows CI 编译测试。
- 候选/发布：仅源码，无新候选。
- 剩余限制：二次读取与 `inner.kill_switch` 赋值之间仍有持锁前的短窗口；需真机看热切换期间状态条。失败的第二次读取丢掉这一拍，不把该次失败计进 Service 腿。
