| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-OWNER-TAKEOVER-STALE-PID | 旧 Service 在健康探测等待中退出，owner takeover 仍按旧 PID 终止，可误杀复用 PID 的进程 | fixed(fdbb126b) | 本 PR · hunt/sol-r3proc-owner-takeover | 低·推导（P2） | Linux 真锁/真进程回归先失败后通过；Windows GNU 检查通过，原生 PID 复用/SCM handoff 未实机执行 |

基线 ad53abb6 的 apps/windows/service/src/core/owner.rs:57 保存裸 PID，:63 等待最多二十次 IPC health probes，再 :77–78 重开该 PID 终止。真实旧 owner 在多秒等待中退出后会释放文件锁和 PID，替代进程可能获得该 PID；代码直到 :87 才再尝试锁，即使锁已空也先杀进程。Window 是 P2，不宣称 P0/P1。

修复先保留 probe 前 image/creation identity；健康 IPC 仍优先、不因 inspection 错误打断健康 owner。探测失败后先重新获取锁，锁已空时直接恢复，不用任何旧 PID。锁仍被占用时拒绝已变化的 PID metadata，Windows 还要求已安装 private Service image，再用 #994 的 same-handle checked termination；未知身份拒绝。Supported 历史版本 59737f59 / 81d51710 / 55f31a2b 和当前都注册 ProgramData/bin Service，未找到普通 Program Files daemon 路径。temporary emergency-disarm helper 不是 daemon，不应被 takeover 杀掉。

回归 tests::released_owner_is_reacquired_without_killing_a_stale_pid：真实 owner 文件锁、真实 foreign child，PID 文件模型化 stale numeric evidence；明确 poll 一次把 takeover 停在 health await，再释放 predecessor。原实现杀 child，修复重新取得锁并保留 child。全部 owner 回归 baseline 2 passed / 2 failed，fixed 4 passed / 0 failed。没有实际强迫 OS PID 复用，未改机器网络。
