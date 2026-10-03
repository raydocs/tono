| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CORE-REAPER-PID-REUSE | Windows 孤儿 Core 清扫丢弃创建时间，枚举后按裸 PID 再打开并结束进程；旧 Core 退出且 PID 被复用时可能误杀其他应用，启动记录恢复也有同一检查后再打开的窗口 | fixed(c1f1561a) | [#994](https://github.com/raydocs/tono/pull/994) | 低·已确认（P2，过期身份回归） | Linux 回归证明创建时间不匹配时旧实现会结束真实子进程，修后保留；未复现 Windows 实际 PID 复用。Windows 同一 handle 查询身份并结束进程，需 hosted Windows CI 和实机。Unix 仍是查询后发信号，不声称消除 Unix PID 竞争。watchdog 超时和 SCM 裸 PID fallback 未扩入本修复。 |

Ownership: SHIP_PLAN §2 item 10. Baseline `e504f6f4`.

Evidence: `core/process.rs:637` kept only `(pid, executable)`, while the loop at `:565`
called `terminate_process(pid)`. Its Windows worker opened that PID again with termination
rights and never checked the earlier creation time or image. `core/reconcile.rs:33–41`
checked a durable identity, then used the same bare termination. An old unsupervised Core
that exits during cleanup can lose its last handle and have its PID reused before the
termination worker runs. The timing requirement limits severity to P2.

The fix keeps the enumerated `ProcessIdentity`, compares it through the Windows handle
that will also be passed to `TerminateProcess`, and leaves a missing/mismatched instance
untouched. Unreadable identity and unconfirmed termination remain errors. Reconciliation
uses its existing stale-record cleanup and checks socket reachability after a refusal.

One regression changes only a real child's expected creation time. The baseline test used
a forwarding shim to the existing bare termination; it failed because the child was killed.
This is a deterministic stale-identity test, not an OS PID-reuse stress test.

Microsoft's [process handle documentation](https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers)
and [PID reuse explanation](https://devblogs.microsoft.com/oldnewthing/20110107-00/?p=11803)
support the Windows same-handle lifetime guarantee. No WFP/DNS/routing or AI policy changes.
