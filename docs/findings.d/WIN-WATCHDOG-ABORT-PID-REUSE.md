| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-WATCHDOG-ABORT-PID-REUSE | watchdog timeout 中止关闭 Core Job/handle 后裸 PID 重开，仍可误杀复用 PID 的进程 | in-PR | 本 PR · hunt/sol-r3proc-watchdog-identity | 低·推导（P2） | 真实 timeout + 合成 creation mismatch 回归先失败后通过；实际 Windows PID 复用未实机重现，needs-hardware |

基线 `1fb29265`：`apps/windows/service/src/core/manager.rs:1117–1123` 在 5 秒 timeout 后 abort/join watchdog，再按 retained PID 调用裸终止。live ChildGuard Drop（`:239–252`）关闭 kill-on-close Job，并启动异步 child kill；两者可能在 timeout caller 再打开 PID 之前终止并释放原进程 handle。此处是独立于已合 #999 的较窄窗口：#999 解决 confirmed-dead 后等清理的长窗口，但不解决 live guard 被 abort/drop 的重开。仅 P2。

修复把既有 runtime-record identity 查询结果缓存到内存；四个 caller 查询时均仍持有原未 reaped Child handle，Windows 此时不能复用 PID。clear → query → cache → 原 disk write → publish PID，写盘失败也保留可信身份。abort/join 后只读取该缓存，检查缓存 PID 与 remaining PID 一致，再调用 #994 的 same-handle executable/creation 终止；不读磁盘，不新查询 current PID 来授权，没有裸 PID fallback。不能证明身份仍拒绝，现有 failed-child retry 保留。

回归 `core::manager::tests::watchdog_timeout_does_not_kill_a_reused_pid`：真实 sleep 子进程、真实 5 秒 stop_watchdog timeout，expected 只改 creation time。旧 fallback 终止子进程（0 passed / 1 failed）；修复 manager suite 6 passed / 0 failed。不是 OS PID 复用实机实验。Windows GNU cargo check --lib --tests 通过；VM 无 Windows 原生运行。

额外 `test_reliability::core_watchdog_stops_after_bounded_crash_loop` 在本机修复与 unmodified `1fb29265` 都因 StartClash fixture HTTP 400 在 Core spawn 前失败（0 passed / 1 failed），未删改/跳过该测试，交 CI 的原生环境确认。严格模式、AI blocking、DNS 与 WFP 撤销顺序无改动。
