| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PINS-REFRESH-TUN-RACE | macOS 仅钉子刷新在 `/core/sync` 重启 Core 后不等 utun199 重建就按 `[tonoTunInterface]` 收敛武装 PF，helper `validateTunnels` 拒绝不存在的接口，catch 当作 `managed_direct_pf_convergence_failed` 断开并保护重连：例行后台钉子刷新切断健康会话 | fixed(674f693b) | [#782](https://github.com/raydocs/tono/pull/782) | 高·推导 | 与 #608 同族（完整重载分支已等，仅钉子分支漏等）；等待最长约 5 s；真正缺失 TUN 仍走原有致命收敛路径，未放宽；无 XCTest（该分支无可注入缝隙，亦无此文件的源码结构测试）；未实机验证 |

来源：任务核对（2026-09-30，读码确认）。`reloadCoreConfig(applyingDirectPolicy:)` 的仅钉子分支
（`apps/macos/Tono/Services/AppState+Proxy.swift`）在 `api.reloadConfig(path:)` 返回后、`pinsRuntimeCommitted = true`
之后直接收敛武装；`reloadConfig` 在控制器应答即返回，早于新 Core 进程重建自有 utun。修复：该分支与完整重载分支同样先
`waitForOwnedTunnelInterface()`，失败抛同款 `commandFailed`，落入既有收敛失败路径（真正缺失 TUN 的正确处置）。
