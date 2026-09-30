## 2026-09-30 · 仅钉子刷新等 utun 重建后再收敛武装 PF

- 归属：SHIP_PLAN 客户连接路径（托管直连策略后台刷新）。不是 G4 发布项，不发客户包。
- 来源：main `026e747c` → 分支 `glm/mac-pins-refresh-tun-wait`；PR 待开；未合 main。
- 缺陷修复：`reloadCoreConfig(applyingDirectPolicy:)` 的仅钉子分支在 `/core/sync` 重启 Core 后立即以 `tunnelInterfaces: [tonoTunInterface]` 收敛武装 PF；控制器应答早于新进程重建 utun199，helper `validateTunnels` 拒绝不存在的接口，catch 按 `managed_direct_pf_convergence_failed` 断开并保护性重连——例行的后台钉子刷新把健康会话整个切断（MAC-PINS-REFRESH-TUN-RACE）。现在该分支与完整重载分支（#608）一样先 `waitForOwnedTunnelInterface()`（最长约 5 s）再武装；等待放在 `pinsRuntimeCommitted = true` 之后且不吃取消，真正缺失的 TUN 仍走原有致命收敛路径，检查未放宽。
- 新增/优化：无。
- 工程与测试：未加 XCTest：该分支无可注入缝隙（`PrivilegedRuntimeCoordinator.shared` 直连 helper XPC，`KillSwitchService.interfaceExists` 是普通静态函数，首步武装在触达分支前就会抛），apps/macos/TonoTests 也没有针对 `AppState+Proxy.swift` 的源码结构测试可加断言。
- 验证：本机无 Xcode/Swift，XCTest 未执行（BUILD_AND_TEST：hosted CI 跑 macOS 构建）；缺陷与修复均为读码确认（`AppState+Proxy.swift` 仅钉子分支对 #608 同族等待的遗漏）。未实机验证。
- 候选/发布：仅源码，无新候选。
- 剩余限制：utun 未重建窗口内的钉子刷新最多多等约 5 s；真正缺失 TUN 仍断开加保护重连（设计如此）；行为与 #608 修复分支一致但未实机复现原竞态。
