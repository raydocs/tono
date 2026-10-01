| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-BOOT-HOLD-DNS | 非严格会话在重启后，开机守卫不重放 Core，但 wanted 屏障和指向 `198.18.0.2` 的保护 DNS / NRPT 仍在，登录前解析落到没有进程应答的地址 | open | [#829](https://github.com/raydocs/tono/issues/829) | 中·推导 | 不修：恢复普通 DNS 会拆掉当前这一套屏障，AI 拦截没有单独的地板；严格模式必须保持 fail-closed。不是重开 BRICK-W1 |

基线 `c26025ec`。`windows_kill_switch.rs` 的有效 wanted 记录会在开机装回过滤器，不走 `crash_recovery_releases_network`。`desired.rs` 的 `recorded_in_this_boot` 为假时不启动 Core，也不清屏障。`dns/mod.rs` `initialize_status_cache` 在快照存在且屏障 wanted 时把 `PROTECTION_WANTED` 置上。
