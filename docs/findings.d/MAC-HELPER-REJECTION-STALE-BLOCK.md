| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HELPER-REJECTION-STALE-BLOCK | macOS helper 对当前这份 Tono 回 403 后，App 暂停重试并保留 Protected Offline；Core 已停，helper 看门狗约 30 秒后释放 PF，App 读不到，菜单栏、首页和横幅继续说「已拦住直连」 | in-PR | [#1305](https://github.com/raydocs/tono/issues/1305) / [#1335](https://github.com/raydocs/tono/pull/1335) | 中·推导（P2） | 只改显示：改说「保护状态未知」，「修复并重新连接」「恢复正常网络」保留。App 仍然读不到 PF 的真实状态，也不会自动释放（需要管理员重装）。诊断快照里的 stage 仍是 Protected Offline。未实机，needs-hardware |

依据：`tooling/scripts/core-helper/SocketServer.swift` `observeCoreForWatchdog`（Core 不在运行且存在已保存的拦截时，达到阈值后 `disarm`）；`apps/macos/Tono/Services/AppState+Connect.swift` `reconcileConfirmedExternalProtectionRelease` 的 `.rejected` 分支（保留 `isProtectionBlocked`，暂停重试）。从 [MAC-PAUSE-WATCHDOG-STALE-BLOCK](MAC-PAUSE-WATCHDOG-STALE-BLOCK.md) 拆出。
