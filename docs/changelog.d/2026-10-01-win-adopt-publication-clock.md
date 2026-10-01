## 2026-10-01 · 未登记后继进程的采纳要晚于发布时钟

- 归属：SHIP_PLAN §2 第 10 项（不断网）。Windows 更新采纳。
- 来源：`origin/main` `d7e24ec9`。分支 `cursor/win-adopt-publication-clock-d3c7`。未合 main。
- 缺陷修复：没有记录后继进程时，采纳要求新进程的 `started_at` 晚于发布完成后记下的进程时钟。这个时钟和 `GetProcessTimes` 相同，不是收据上的 Unix 时间。发布成功后、创建后继进程之前写入；恢复发现已验证安装但还没有这个字段时补记一次，之后不再改。字段缺失的旧记录仍可采纳。
- 新增/优化：无。
- 工程与测试：`update_unregistered_successor_must_start_after_the_publication_clock`。同模块 14 条更新事务测试通过。
- 验证：Linux `cargo test --locked --features standalone,client,test --lib update_transaction::`，14 passed。`cargo check --target x86_64-pc-windows-gnu --bin tono-service-install` 通过。没有 Windows 实机。
- 候选/发布：仅源码，无新候选。
- 剩余限制：更旧的执行器重写记录时会丢掉这个可选字段，地板随之消失。没有拿 Unix 时间去比 `started_at`。
