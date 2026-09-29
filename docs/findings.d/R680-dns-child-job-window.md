| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R680-dns-child-job-window | Windows DNS 引擎起 powershell.exe 时不带 `CREATE_SUSPENDED`，创建之后才把它放进退出 Job；卸载助手若在创建与入 Job 之间走 `process::exit`，或入 Job 失败（只记 warn），没入 Job 的恢复脚本会比助手活得久，可能覆盖之后安装或连接写下的 DNS | open | [#680](https://github.com/raydocs/tono/pull/680)（评审修正轮留下） | 低·已确认 | 尚无修复。窗口只在创建到入 Job 之间，或入 Job 失败时；入 Job 前起的孙进程同样不在 Job 里；已交给 WmiPrvSE 的单个 CIM 调用不随 powershell 结束而撤回 |

来源：PR #680 代码评审 6dc04df2 的修正轮（codex:F1 用 kill-on-close 退出 Job 修复）之后，复评 codex:F1 与 opus:F1。
证据（行号为 `83b0c623`）：`apps/windows/service/src/core/dns/engine.rs:841-866`（`spawn_before_deadline`：`spawn()` 后才调
`bind_to_process_exit`，失败只 `tracing::warn!`）、`apps/windows/service/src/core/process.rs` `bind_to_process_exit`。按停止规则
（只 major 及以上阻塞，minor 一轮后记 open）记录，未再修。可能的方向：以挂起方式创建并在恢复主线程前入 Job，或用
`PROC_THREAD_ATTRIBUTE_JOB_LIST` 在创建时入 Job；入 Job 失败时是否拒绝运行脚本需另行权衡（拒绝会让 DNS 恢复失败）。
