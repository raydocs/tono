## 2026-10-13 · Windows：Core 以挂起状态创建，加入 Job 之后才运行
- 归属：SHIP_PLAN §2 item 10；Windows Service（`apps/windows/service/src/core/manager.rs`，Core 启动 / 进程监管）。
- 来源：基线 origin/main → 分支 `claude/win-core-job-spawn`；Refs #1056（WIN-CORE-JOB-SPAWN-WINDOW）；无需产品决定。
- 缺陷修复：Core 原先普通 spawn，之后才 `AssignProcessToJobObject`；Service 在这段间隙崩溃会留下一个未被 kill-on-close Job 监管的运行中 Core。改后：先创建 Job，用 `CREATE_SUSPENDED` 创建 Core，通过 spawn 返回的进程句柄加入 Job，再恢复其线程（沿用 `process.rs` 里 DNS 辅助进程已用的 suspended→assign→resume 顺序）；加入或恢复失败即终止 Core 再返回错误。间隙里崩溃只会留下一个永不运行的挂起进程，不再是运行中的未监管 Core；SCM 重启后的 installed-image sweep 照旧回收它。
- 新增/优化：无。
- 工程与测试：`the_core_runs_nothing_until_it_has_joined_its_job`（Windows，`restart_while_recovering_tests`；测试缝 `TEST_AFTER_CORE_SPAWN`）。
- 验证：见 PR 正文 `## Verification`。未在 Windows 实机强制该崩溃间隙。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未用 `PROC_THREAD_ATTRIBUTE_JOB_LIST`（std/tokio 稳定接口不提供）；崩溃间隙仍会留下一个挂起的孤儿进程（不运行，由重启后的 sweep 回收）。待实机。
