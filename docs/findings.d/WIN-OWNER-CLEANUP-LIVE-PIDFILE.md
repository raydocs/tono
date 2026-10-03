| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-OWNER-CLEANUP-LIVE-PIDFILE | 旧 takeover 在重新获取 owner 锁之前删 PID 文件，可删除健康启动中 successor 的监督证据 | fixed(fdbb126b) | 本 PR · hunt/sol-r3proc-owner-takeover | 低·推导（P2） | Linux 真锁/真 successor 回归先失败后通过；Windows 原生启动交接仍需 CI / needs-hardware |

基线 ad53abb6 apps/windows/service/src/core/owner.rs:85 在 probe 失败后、不持有 owner 锁时调用 cleanup；:245 删除 PID 文件，之后 :87 才获取锁。旧 owner 在 probes 中死亡，另一个普通启动进程可先获得锁并写新 PID；旧 takeover 清掉 successor 的证据，再重试锁失败返回错误。successor IPC 未就绪时可走此路径（启动/恢复需要时间），仅 P2 timing race。

修复只在实际取得锁之后清理旧 Unix IPC artifact；ServiceOwnerGuard 已重写 PID metadata，因此 cleanup 不再删除 PID。健康 winner 和变更的 owner 仍被保留，与 WIN-OWNER-TAKEOVER-STALE-PID 是同一 handoff/ownership cluster。

回归 tests::failed_owner_takeover_preserves_successor_pid_metadata：真实 owner_lock_holder 子进程与文件锁；先 poll takeover 到 health await，再结束旧 holder、由 parent 取得真实 successor 锁并写 PID。旧实现拒绝锁但删除 successor PID（None），修复拒绝 stale takeover 并保留 parent PID。baseline owner suite 2 passed / 2 failed；fixed 4 passed / 0 failed。RAII 清理进程，无生产 test hook，也未改网络配置。
