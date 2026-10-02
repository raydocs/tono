| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-ORPHAN-TUNNEL-SESSION | App 在已连接时崩溃或被强退，helper 保留 Core 和已提交的 PF 阻断；之后出口不可达时所有包仍进 TUN，机器断网直到重开 Tono | in-PR | [#1269](https://github.com/raydocs/tono/issues/1269)；[#1357](https://github.com/raydocs/tono/pull/1357) 修 | 中·推导 | 没有实机验证；放开约在出口连续不可达 70 秒后；纯 IPv6 网络不触发；放开后是真实地址且没有 App 提示（[决策 049](../decisions/049-2026-10-02-macos-orphaned-session-release.md)） |

依据（`main` `cc673eaa`）：`SocketServer.observeCoreForWatchdog` 在 Core 运行时只调 `observeOrphanedBootstrap`（只管 `tunnelInterfaces` 为空的 bootstrap 阻断）和 `superviseProtection`；看门狗只看 Core 进程是否存活，不看出口是否可达。App 死后没有任何一方做出口健康检查。

修复（#1357）：`observeOrphanedTunnel` 在同一个 10 秒空闲检查里运行。属主确实已退出、会话已提交、无进行中的原生更新、有 IPv4 上行时，通过自己的 Core 发一次出口延迟探测（非阻塞：这次检查发起，下次检查读取结果）；连续失败到阈值后按 bootstrap 孤儿同一条路径放开（停 Core、`disarm`、恢复 DNS、清属主）。出口可达、属主存活或未知、无上行、配置读不出都不计数。决策函数 `SocketServer.orphanedTunnelAction` 是纯函数，回归在 `KillSwitchManager.runSelfTests`。helper 协议版本 `4.52.39`。

未关的限制：
- 没有 Mac 实机验证：属主死亡判定、`State:/Network/Global/IPv4` 在隧道在时仍指向物理网络、URLSession 在 root helper 里对回环控制端口的行为，都只有源码和既有同类路径（`UpdateRuntime.verifyRecovery`）作依据。
- 属主死后只要出口可达，helper 每 10 秒经出口做一次延迟探测（一个到 `gstatic` 的 204 请求），直到 Tono 重开或会话结束。
- helper 在会话中途重启后没有属主记录，这条不触发（和 MAC-ORPHAN-BOOTSTRAP-PF 相同）。
- 所选出口坏了但目录里别的出口还通时，helper 不换出口，直接放开。
