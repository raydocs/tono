## 2026-09-30 · Windows watchdog 及时退休已死 Core PID
- 归属：SHIP_PLAN §2 第 10 项；Windows Service Core 生命周期。
- 来源：基线 `d33399bb` → 本 PR；分支 `hunt/sol-r3proc-watchdog-dead-pid`，尚未合 main。
- 缺陷修复：Core 已死后的 WFP/元数据等待保留旧 PID → 确认退出立即退休记账 PID，避免 5 秒 watchdog join 超时按此旧 PID 误杀其他进程；发现 WIN-WATCHDOG-TIMEOUT-PID-REUSE（P2）。
- 新增/优化：无新功能；packed security identity 仍在 WFP barrier 中撤销，严格模式和 AI 规则不变。
- 工程与测试：一个真实子进程/真实 watchdog 的窄回归；wait 错误确认终止失败仍保存 ChildGuard 供既有重试。
- 验证：Linux VM，`CARGO_BUILD_JOBS=2 cargo test --locked --features standalone,client,test --lib core::manager::tests::`；原实现新回归 0 passed / 1 failed，修复后 5 passed / 0 failed；`git diff --check` 通过。Windows 原生编译/执行交由托管 CI，实机 WFP 延迟/PID 复用未执行。
- 候选/发布：仅源码，无新候选、无部署或发布。
- 剩余限制：needs-hardware；要求正常/失败停止仍能回收 Core，保留 AI 阻断和严格模式。新代码未实机制造 PID 复用。
