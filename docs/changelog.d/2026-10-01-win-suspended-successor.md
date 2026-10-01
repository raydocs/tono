## 2026-10-01 · 挂起的更新后继进程不再被当成恢复成功

- 归属：SHIP_PLAN §2 第 10 项（不断网）。Windows 更新恢复。
- 来源：`origin/main` `5ba113d2`。分支 `cursor/win-suspended-successor-d3c7`。[#887](https://github.com/raydocs/tono/pull/887)。未合 main。
- 缺陷修复：恢复任务看到记录中的后继镜像仍在，但主线程从未 Resume 时，不再直接返回成功。它 Resume 该进程并启动服务。屏障保持，等这个 App 自己连上隧道。Resume 失败则结束该进程、启动服务，再按安装身份分类，而不是把冻结进程当成已在运行。
- 新增/优化：无。
- 工程与测试：`never_resumed_recorded_successor_does_not_count_as_forward_recovery`。Win32 挂起查询只在 Windows 上编译。
- 验证：Linux `cargo test --locked --features standalone,client,test --lib never_resumed_recorded_successor_does_not_count_as_forward_recovery`。没有 Windows 实机。
- 候选/发布：仅源码，无新候选。
- 剩余限制：Resume 失败后用户仍停在启动期屏障上，直到打开 App。没有把屏障拆掉，以免同时丢掉 AI 服务拦截。
