| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-WATCHDOG-TIMEOUT-PID-REUSE | Core 已确认退出但 watchdog 清理还保留 PID，停止超时后可能误杀复用此 PID 的其他进程 | in-PR | 本 PR · hunt/sol-r3proc-watchdog-dead-pid | 低·推导（P2） | 原生 Windows PID 复用未实机复现；Linux 真实 watchdog 回归先失败后通过；Windows CI / needs-hardware 待验 |

基线 `d33399bb`：`apps/windows/service/src/core/manager.rs:826–837` 的 shutdown 分支在 `kill_now()` 确认子进程死亡、关闭句柄后离开循环。最终 WFP 清理 `:1057` 可等待 25 秒的原生调用（`core/windows_kill_switch.rs:944`），但 `running_pid` 到 `:1065` 才清空。`stop_watchdog` 只等 5 秒（`:39`），超时中止任务后 `:1101–1106` 按旧 PID 重新打开进程并终止。自然退出分支 `:843` 到元数据/WFP await 也有相同窗口。需要普通清理延迟与 PID 复用，因此是 P2，不宣称 P0/P1。

修复在 `wait()` 成功或 `kill_now()` 成功后、任何清理 await 前退休进程记账 PID；安全 packed identity 仍在原 WFP writer barrier 中撤销。`wait()` 错误先尝试确认终止；不能确认时保存 ChildGuard 供现有 stop 重试，不假报进程已死。正常 StartClash 无条件先 stop/join 旧 watchdog，desired restore 只在 IPC 启动前执行一次，所以提前退休记账不绕过正常启动监督。

回归 `core::manager::tests::an_exited_core_pid_is_retired_before_watchdog_cleanup_waits` 运行真实退出子进程与真实 watchdog，用元数据锁暂停退出后清理，检查 PID 已退休。基线 0 passed / 1 failed；修复后 manager suite 5 passed / 0 failed。测试直接 abort/join，不调用旧 PID kill fallback，避免失败测试误杀别的进程。Linux 不修改机器网络；真实 WFP、Windows 原生执行和实际 PID 复用未在 VM 验证。严格模式、AI 服务规则、DNS 还原及 WFP 安全撤销顺序保持既有规则。
