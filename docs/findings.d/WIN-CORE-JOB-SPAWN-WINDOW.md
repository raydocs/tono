| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-CORE-JOB-SPAWN-WINDOW | Service 在 Core 创建与 Job 绑定之间崩溃可留下未被 Job 监督的运行 Core | fixed(a0a859eb2) | [#1056](https://github.com/raydocs/tono/issues/1056) · [#1628](https://github.com/raydocs/tono/pull/1628) | 低·推导（P2） | 修复为 CREATE_SUSPENDED → 加入 Job → 恢复（与 DNS 辅助进程同序）：崩溃间隙只留下永不运行的挂起进程，不再是未监管的运行 Core；native crash 实验未做（待实机）；SCM 重启后的 installed-image sweep 仍回收孤儿 |

在审计基线 ad53abb6，apps/windows/service/src/core/manager.rs:1190 先普通 unsuspended spawn，:1217 初始化 job:None，:1225 才 WindowsCoreJob::attach；实际 AssignProcessToJobObject 在 :137。没有 Service-wide Job assignment、自动父进程生存期 watcher、creation-time Job list 或其他覆盖此窗口的生产 guard。fatal Service crash 在这个短区间绕过 Rust Drop，可留下一个未 containment 的 Core；只是毫秒级 P2。

[Microsoft 的 Job 创建说明](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)规定 kill-on-close 只影响已关联进程，[Microsoft 对同一创建/绑定窗口的分析](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812)提供 creation-time PROC_THREAD_ATTRIBUTE_JOB_LIST 的方向。单纯先 suspend 并不消除 parent crash 后尚未绑定的 orphan 窗口。

SCM 会以 5/10/30 秒恢复，startup reconciliation 的 installed-image sweep 能回收没有 runtime record 的 orphan，所以不宣称 P0/P1 或永久断网。runtime record 只在 attach 成功后写，不能覆盖此间隔。uninstall/NSIS 没有独立 process-table Core reaper；通常之前 SCM 已回收，长期遗留还需要后续恢复故障。

本报告未改 launcher：需要 Windows 原子创建/Job 绑定的独立实现和 native 回归，不能仅用 suspend/resume 粉饰窗口，也未引入 undocumented syscall。[Rust 的 spawn_with_attributes 在当前 stable 文档仍为 nightly-only](https://doc.rust-lang.org/std/os/windows/process/trait.CommandExt.html#tymethod.spawn_with_attributes)，现有 Tokio/std 路径不能用一个 stable attribute 调用完成。未在 Windows 实机强迫此 crash；Source trace + OS contract 是推导证据。

修复续记（2026-10-13）：`run_with_logging` 先 `WindowsCoreJob::create`，以 `CREATE_SUSPENDED` spawn，经 tokio `Child::raw_handle` 加入 Job，再 `resume_suspended_process`；上文「单纯先 suspend 并不消除 orphan 窗口」成立——窗口里仍可能留下一个挂起孤儿，但它不运行、不持有隧道，且由重启后的 sweep 回收，所以判定为把「未监管的运行 Core」降为「未运行的挂起进程」，而非完全消除窗口。
