## 2026-10-07 · Windows 崩溃窗口重连标志绑定被释放会话的 owner
- Status: provisional
- Chosen: Service 在崩溃窗口释放（`release_unproven_wanted_session_unlocked`）时，把被释放会话的 `owner_key`（与租约、`authorize_write_for` 同一个 SHA256(SID) owner）记为重连标志的 owner：内存里与标志一起保存，墓碑里另起字段 `reconnect_owner_key`，墓碑本身仍不带 `owner_key`。`/status` 与 `GetKillSwitchStatus` 只向这个 owner 报 `reconnect_after_release: true`；其他已登录用户的 App 读到 false，不会自动连接、不消费也不删除该标志。没有 owner 的标志（旧版墓碑，或释放的 intent 本身没有 owner）谁都不报；第一个本会读到它的调用方把内存标志清掉，并记一行 warn 日志。
- Rejected: (1) 维持现状、标志对所有已认证调用方可见——另一用户的 App 会用自己的账号自动连接并接管机器保护，原用户再连得到 1014（#1291）。(2) 在 App 侧比对 owner——App 拿不到被释放会话的 owner，且旧 App 仍会照单全收；在 Service 的 IPC 边界过滤对新旧 App 都成立。(3) 无 owner 的旧标志继续对所有人有效（兼容）——正是本缺陷的形状，按更严选项不再认。
- Why stricter: AGENTS「Finish the work」第 3 条：选更严、不泄露的选项。代价只是：升级前写下的无 owner 崩溃墓碑不再触发自动重连，用户手动点连接即可；网络在该窗口本来就是放开的（AI 保持拦截），不影响失败关闭。显式释放的跨用户语义（H2-F2）不变。
- Applied in: PR 待开（`apps/windows/service/src/core/windows_kill_switch.rs`、`status.rs`、`server/handlers.rs`），记录 [2026-10-07-win-reconnect-flag-owner-bound.md](../changelog.d/2026-10-07-win-reconnect-flag-owner-bound.md)，finding [R4-WIN-MU-RECONNECT-FLAG](../findings.d/R4-WIN-MU-RECONNECT-FLAG.md)。
