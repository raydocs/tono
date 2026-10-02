| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-BOOT-HOLD-DNS | 非严格会话在重启后，开机守卫不重放 Core，但 wanted 屏障和指向 `198.18.0.2` 的保护 DNS / NRPT 仍在，登录前解析落到没有进程应答的地址 | fixed | [#829](https://github.com/raydocs/tono/issues/829)；[#740](https://github.com/raydocs/tono/pull/740) | 中·推导 | 严格模式按设计保持整块拦截，保护 DNS 也不恢复，直到用户连接或断开。没有实机重启验证 |

基线 `c26025ec`。`windows_kill_switch.rs` 的有效 wanted 记录会在开机装回过滤器，不走 `crash_recovery_releases_network`。`desired.rs` 的 `recorded_in_this_boot` 为假时不启动 Core，也不清屏障。`dns/mod.rs` `initialize_status_cache` 在快照存在且屏障 wanted 时把 `PROTECTION_WANTED` 置上。

2026-10-02 复核（`main` `b1df598c`，只读源码）：非严格会话已不再停在这个状态。`restore_on_service_start`（`windows_kill_switch.rs`）在装回 wanted 屏障后，如果 Core 没在运行、这次开机也不会重放（`desired::core_replay_expected_this_boot`，开机标记不一致时为假），立即走 `release_unproven_wanted_session_unlocked`：先 `dns::ensure_restored()`，装 AI hold（决策 031），再移除 WFP。两条启动路径都先恢复屏障再调 `initialize_status_cache`（`service.rs`），此时屏障已不是 wanted，DNS 看门狗不会把 `198.18.0.2` 写回去。提出本条时所说的「恢复 DNS 会丢掉 AI 地板」已由选择性释放解决。
