## 2026-10-07 · Windows 崩溃窗口重连标志只报给被释放会话的 owner
- 归属：SHIP_PLAN §2 item 10（0.0.75 修复批次，所有者 2026-10-07）；Windows Service（`apps/windows/service`）。
- 来源：基线 `origin/main` de62eb2a5 → 分支 `claude/win-reconnect-flag-owner-bound-20261007`，PR [#1450](https://github.com/raydocs/tono/pull/1450)；未合 main。
- 缺陷修复：R4-WIN-MU-RECONNECT-FLAG（#1291）。原来崩溃窗口释放后全局 `RECONNECT_AFTER_RELEASE` 不带 owner，`status()` 对所有已认证调用方报 `reconnect_after_release`，另一个已登录用户的 App 会在启动恢复或 Protected Offline 重同步里用自己的账号自动连接并接管，原用户再连得到 1014。改后：释放时记下被释放会话的 `owner_key`（内存 + 墓碑新字段 `reconnect_owner_key`，墓碑本身仍无 owner），`/status` 与 `GetKillSwitchStatus` 经 `status_for(owner)` 只向该 owner 报 true；其他用户读到 false，不消费也不清除。无 owner 的旧标志谁都不报，第一个读到的调用方清掉内存标志并记 warn 日志。决策见 [075](../decisions/075-2026-10-07-windows-reconnect-flag-owner-bound.md)（provisional）。
- 新增/优化：无。
- 工程与测试：新增回归 `crash_window_reconnect_is_reported_only_to_the_released_owner`（`windows_kill_switch.rs`）：Alice 的已验证会话在崩溃窗口被释放后，Bob 读到 false，Alice 在 Bob 读过之后仍读到 true，墓碑记 `reconnect_owner_key = owner-alice` 且 `owner_key` 为空。旧测试改用 `crash_recovery_tombstone(None)`。
- 验证：本机（MacBook）按规定不跑 `cargo`；只跑了 `rustfmt --check` 看改动行。Rust 编译与测试由 PR 上的 `ci-gate`（windows-2025）证明。
- 候选/发布：无新包，仅源码。
- 剩余限制：双账号实机未验证；升级前写下的无 owner 崩溃墓碑不再自动重连（用户手动连接）；内存清除不改写磁盘墓碑，Service 每次重启后第一个读取方会再清一次并记日志；显式释放的跨用户语义（H2-F2）不变。
