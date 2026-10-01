## 2026-10-01 · Windows 更新执行器没启动时不再把网络留在阻断
- 归属：SHIP_PLAN §2 item 10；Windows Service `core/update.rs`，App `commands/update.rs`，发现 WIN-UPDATE-SPAWN-FAIL-BLOCK。
- 来源：基线 `c2626f53` → `3a7b1f26`；PR #961；未合 main。
- 缺陷修复：Prepare 成功后 WFP 已是 bootstrap Blocked、Core 已停、DNS 已恢复。Install 先把执行状态写成 Launching 再 spawn。spawn 失败时没有 executor，App 仍把 Launching / Consumed / Replaced 当成已经启动并返回成功，机器一直阻断。现在先 spawn。失败且不是显式严格 kill switch 时，选择性释放（普通流量恢复，AI 目的地仍阻断），错误文案按这个结果写。严格模式保持 Blocked，文案也这么说。App 不再把所有失败都包成「protection retained」。
- 新增/优化：无。
- 工程与测试：`an_executor_that_never_starts_releases_unless_the_kill_switch_is_strict`。
- 验证：本机 rustc 1.83 不能编译 edition 2024 / rust-version 1.98，`cargo test` 未执行。由 Windows CI 编译测试。
- 候选/发布：仅源码，无新候选。
- 剩余限制：spawn 已成功但随后 `image()` 失败时，进程存在而身份还没写入，不在这次释放里。Service 下次启动若看到 Launching 且 executor 已死，仍按原设计保留屏障并把状态退回 Staged，不在这次改。needs-hardware。
