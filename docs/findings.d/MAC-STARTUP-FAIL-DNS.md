| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-STARTUP-FAIL-DNS | 守护进程启动失败（如绑定用户被删，`allowedGroup` 的 getpwuid 返回空）时 `secureFailedStartup` 只清保存的 PF 状态：已保存的受保护 DNS 快照不被恢复，系统解析器留在 127.0.0.1 且无监听，launchd KeepAlive 每次重启重复同一失败，整台 Mac 无 DNS | in-PR | 待开 | 中·推导（读码；未实机） | 恢复是 best-effort：失败只记 stderr 不抛错；若启动失败时上一代 core 仍在跑，快照恢复会把解析器从 127.0.0.1 拉回原始服务器（与紧急路径同判：失败方向放通）；生产装配的闭包本体无法进 self-test（会动真实 DNS），由 `runStartupDNSRecoverySelfTest` 钉顺序与不逃逸 |

`SocketServer.init` 第一步 `allowedGroup(for:)` 就可能在 `getpwuid` 为空时抛错，早于 `CoreManager`/`ProtectedDNSManager` 的构造；
`startHelperDaemon` 捕获后调用生产 `secureFailedStartup`（原为 `KillSwitchManager.secureFailedStartup`，仅 `releasePersistedBlock()`）。
修复（分支 `glm/mac-helper-recovery`）：main.swift 底部的装配改为 `secureFailedStartupRestoringDNS`——先照旧清 PF，
再 `ProtectedDNSManager().restore(deferringLossNotice: true)` 尽量恢复快照；`KillSwitchManager.secureFailedStartup` 语义不变（无其他调用方）。
