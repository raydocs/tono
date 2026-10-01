# W1-grok-win-wfp 搜寻报告

- 席位：W1-grok-win-wfp（第二评审，在 Sol 之后）
- 基线：origin/main `c32c087e`（报告分支）；修复分支基于当时的 `ff81118a`
- 模型：Grok 4.7
- 日期：2026-09-30
- 范围：`windows_kill_switch.rs`，`wfp/mod.rs`，`wfp_model.rs`，`windows_security.rs`，`manager.rs`，`netmon.rs`，`netmon/topology.rs`，`process.rs`，`proxy.rs`，`macos_kill_switch.rs`

## PR

| PR | 分支 | SHA | 自动合并 | 标签 |
|---|---|---|---|---|
| [#812](https://github.com/raydocs/tono/pull/812) | `hunt/grok-wfp-lock-poison-d8c1` | `2e527713` | 已开，`merge`（merge commit） | `needs-hardware` 未加上：`gh api` 与 `gh pr edit --add-label` 都是 HTTP 403 `Resource not accessible by integration`。这是 kill switch 路径，应按 `needs-hardware` 补标。 |

没有另开 GitHub issue。核对后没有「已核实、本席不修」的缺陷：其余项是误报、已有 PR，或与 #777 的看门狗改动重叠且需要两次失败。

## 结果表

| ID | 区域 | 严重度 | file:line | 一句话 | 结论 |
|---|---|---|---|---|---|
| WIN-LOCK-POISON | W1 | 低 / P2 | `windows_kill_switch.rs:1712` | `lock_unlocked` 用 `ARMED.lock().unwrap()`，持锁 panic 之后隧道 lock 的 IPC 会跟着 panic | 已修，#812 |
| WIN-MARK-VERIFIED-POISON | W1 | 低 | `windows_kill_switch.rs:1255` | `mark_verified` 同一类裸 unwrap | 重复 #753 |
| WIN-STARTUP-RELEASE | W1 | — | `restore_on_service_start` | `wanted:false` 时移除失败会留下持久过滤器；底座许可未持久 | 重复 #753 |
| WIN-TOMBSTONE-REBLOCK | W1 | — | `disarm_unlocked` | 墓碑写失败会重新装上拦截；DNS 快照删不掉会拒绝释放；StartClash 失败留下 WFP | 重复 #769 |
| WIN-DIRECT-LEASE-EXPIRY-BLOCK | W1 | — | `spawn_windows_kill_switch_watchdog` | 已提交 DIRECT 租约过期后停在 Blocked，非严格用户失去普通网络 | 重复 #777 |
| WIN-STOPCORE-INTENT-WRITE | W1 | — | `retract_direct_before_core_replacement` | 精确 Blocked 已证明后，意图写盘失败仍拒绝替换 Core | 重复 #777 |
| — | W1 | — | 看门狗 `consecutive_unhealthy = 0` | 非释放类 DIRECT 失效在撤回失败时清零不健康计数 | 不单开。#777 已改该函数；撤回失败会留下过期回执下一拍重试。安装一直失败还要再叠加一次 WFP 失败，至多 P2，且与 #777 同一段代码 |
| TW-R-boot | W1 | 低 | `status` / `is_verified` | 沿用 `verified` 被当成远程桌面例外的证明 | 已修（#650）。`status()` 仍报告 `is_verified()`，不另报 |
| H1-F6 | W2 | — | DHCP 入站许可 | DHCPv4 应答只按端口放行 | 已知，不重复 |
| H1-F5 | W2 | — | 引导 API 许可 | 引导许可未绑应用 ID | 已知开放项，不重复 |
| — | W2 | — | `wfp/mod.rs` `build_condition` | IPv4 地址用 `from_be_bytes`、掩码用 `u32::MAX << (32-prefix)`，被怀疑端序反了 | 误报。这是主机序，与 MSDN 的 `FWP_V4_ADDR_AND_MASK` 一致。/32 掩码两边都是全 1。没有报文级失败证据，不改 |
| — | W2 | — | `key_for` / `FWP_E_ALREADY_EXISTS` | 键碰撞或已存在键不更新条件 | 误报。活动集上 64 位 FNV 不构成可用碰撞；改标志要升命名空间，#753 已为持久标志升到 v12 |
| — | W2 | — | `windows_security.rs` `ensure_local_system_owner` | 文件属主迁移遇到 1307 会卡死意图写入 | 误报。1307 和无法打开 `SeRestorePrivilege` 已经软失败并继续写 DACL。意外属主仍硬失败，这是有意的 |
| — | W1 | — | `arm_bootstrap` `strict_kill_switch: false` | 严格模式永远写 false | 误报。产品没有用户可见的严格开关。不发明严格模式，也不放宽已有的严格分支 |
| — | W1 | — | `status` `VERIFY_CACHE_TTL` | 存活状态用 5 秒缓存 | 误报。失败的校验会立刻 `note_verify(false)`。缓存是文档化的读路径，`status` 不进 `WFP_OPERATION` |
| — | W1 | — | `emergency_disarm_windows_kill_switch` | NRPT 删除在持有 `WFP_OPERATION` 时阻塞调用线程最多 10 秒 | 误报。有上界。注释写明服务进程不走这条，卸载/恢复 CLI 才走。不是机器卡死 |
| — | W1 | — | `emergency_disarm` 返回标记 | WFP 已删但 DNS/NRPT 结果可能报成仍在拦截 | 误报。继续标记与 `DNS_RESOLVER_POLICY_REMAINS` 的先后和注释里的卸载合同一致 |
| — | W1 | — | 隧道许可权重 8、只绑 LUID | LUID 复用后许可落到别的网卡，漏流量 | 误报。`tunnel_permit_luid` 要求 `armed.core_instance` 等于当前 Core。身份是 PID 加 generation |
| — | W3 | — | `netmon/topology.rs:43` | 任一 `GetIfEntry2` 失败就丢弃整次拓扑读 | 误报为单次断网。半份快照会像一次漫游；整次失败则保留上一份成功样本。网卡一直不可读再叠加窗口内的真实变化才丢更新，至多 P2，不单开 |
| — | W3 | — | `netmon.rs` DNS 自写窗口 | 窗口内的第二次未知变化被吞 | 误报为 P0。要窗口内变化，且读失败或 `external=false` 同时成立。工作者会等到窗口结束，除非已到 3 秒上限 |
| — | W3 | — | `manager.rs` `ChildGuard` Drop | `tokio::spawn` 不在运行时里，子进程泄漏 | 误报。Windows 上 Job 的 kill-on-close 在句柄释放时结束进程 |
| — | W3 | — | `process.rs` `terminate_process_windows` | pid 0 返回 Ok | 误报。pid 0 不发信号，避免误杀。不是孤儿清不掉 |
| — | W3 | — | `proxy.rs` | 系统代理停在已死的 Core | 误报（Windows）。`SERVICE_PROXY_IS_LIVE` 只在 macOS。Windows 的 `clear_service_proxy` 是空成功 |
| — | W3 | — | `macos_kill_switch.rs` `DESIRED.lock().unwrap()` | 与 Windows 毒锁同类，会冻住 PF | 不立 issue。真实 PF 只在 macOS 编译。Windows StartClash 只有请求里带了 macOS `kill_switch` 才调用它；客户 Windows 走 `windows_kill_switch`。仍要先有一次持锁 panic |
| — | W3 | — | `manager.rs` 预启动撤回失败后的 `Running` | 把空闲态显示成 Core 在跑 | 误报。`Running` 在这里是停止后的落定空闲值，不是「核心已起来」 |
| — | W1 | — | 意图文件里的 `api_host_ips` | 本地改文件可把引导许可指到任意地址 | 不立 issue。恢复路径经 `admit_api_host_ips` 再消毒。改文件的是本机管理员，至多 P2 |
| — | W1/W3 | — | 持久 WFP 比进程活得久 | 服务崩溃后过滤器仍在 | 重复 #753 / #769 / #777 / #792。非持久过滤器活到 BFE 重启；`wanted:false` 的启动释放和失败重试已在那些 PR 里 |

假设共 27 条。误报 14 条。与已有 PR 或已修条目重复 9 条。已修 1 条（#812）。不单开 3 条：看门狗撤回失败与 #777 重叠、macOS `DESIRED` 未证实为客户 Windows 路径、本机管理员改 `api_host_ips`。

## 误报理由（短）

- 端序：主机序符合文档，产品若 /32 许可从不命中则连不上，不能靠静态阅读改条件。
- 键碰撞：不是可用的单次失败。
- 严格开关恒为 false：没有用户开关。
- 5 秒校验缓存、紧急解除的 10 秒 NRPT、卸载标记顺序：有界且与注释合同一致。
- 拓扑整读失败、DNS 自写窗口：避免把半份观察当成漫游；要第二次独立条件才丢更新。
- 1307：属主迁移已经软失败。
- Windows 代理、pid 0、ChildGuard、LUID 复用、`Running` 空闲态：调用点或身份检查已经挡住用户可见的断网/泄漏。

## 本地验证

`apps/windows/service`，Rust 1.98.1：

`cargo +1.98.1 test --locked --features standalone,client,test --lib lock_recovers_a_poisoned_armed_lock -- --test-threads=1`

- 修复前：失败，`PoisonError`，`windows_kill_switch.rs:1712`。
- 修复后：`ok. 1 passed`。
- 未跑：实机 WFP。系统自带 rustc 1.83 无法解析 edition 2024，测试用的是 rustup 的 1.98.1。

## 未读完

- `windows_kill_switch.rs` 生产路径读到 `status()`。约 4900 行之后的测试模块没有逐行读完。
- `wfp/mod.rs` 读了条件、安装、校验、删除和 LUID。枚举辅助函数没有逐行读完。
- `wfp_model.rs` 读了规则集、前缀和底座。测试没有逐行读完。
- `windows_security.rs` 读到属主迁移的软失败。文件尾大约 120 行没有逐行读完。
- `manager.rs`、`process.rs`、`proxy.rs`、`macos_kill_switch.rs`、`netmon.rs` 读了上面表里的路径，没有声称覆盖每个辅助函数。
