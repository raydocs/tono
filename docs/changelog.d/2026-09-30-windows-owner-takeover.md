## 2026-09-30 · Windows owner takeover 保留真实 owner 与 PID metadata
- 归属：SHIP_PLAN §2 第 10 项；Windows Service 单 owner 启动/恢复，process.rs 调用链。
- 来源：基线 ad53abb6 → 本 PR；分支 hunt/sol-r3proc-owner-takeover，尚未合 main。
- 缺陷修复：health probes 期间旧 owner 退出后仍按裸旧 PID 终止，以及在未取得锁时删 successor PID → probes 后先重新取得锁，保留 probe 前身份、拒绝已变更/未知 owner，Windows 检查 private Service image，checked kill；IPC 清理只在取得锁后，PID 重写后不再删除。发现 WIN-OWNER-TAKEOVER-STALE-PID / WIN-OWNER-CLEANUP-LIVE-PIDFILE（均 P2）。
- 新增/优化：无新功能；健康 IPC owner 不因 identity 读取错误被拒绝，已释放锁仍能恢复；未知/unreadable live owner 不允许裸 PID kill。AI/strict/DNS/WFP 规则未改。
- 工程与测试：两条真锁/真进程的 hook-free 窄回归，各覆盖一个行为，first pending poll 确定同步；RAII 清理。
- 验证：Linux VM，CARGO_BUILD_JOBS=2；cargo test --locked --features standalone,client,test --test test_reliability owner_，baseline 2 passed / 2 failed，fixed 4 passed / 0 failed，包含既有 healthy/stale owner 正例；Windows GNU cargo check --lib --tests 通过，git diff --check 通过。Windows 原生 runtime 未在 VM 执行。
- 候选/发布：仅源码，无新候选、无部署或发布。
- 剩余限制：needs-hardware；不把合成 PID evidence 模型称作 Windows OS PID 复用实机实验。锁仍被占用而 installed image 不可读取时拒绝 takeover，既有 emergency recovery fallback 未改。
