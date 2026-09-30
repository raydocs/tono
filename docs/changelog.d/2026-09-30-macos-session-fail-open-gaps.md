## 2026-09-30 · 连接中健康监视器的两处 fail-open 缺口

- 归属：SHIP_PLAN 客户连接路径（macOS 会话健康监视器）。不是 G4 发布项，不发客户包。
- 来源：main `01c2403f` → 分支 `glm/mac-app-fail-open`；PR [#760](https://github.com/raydocs/tono/pull/760)；未合 main。
- 缺陷修复：
  - `MAC-BROWSER-DOH-FAIL-CLOSED`（约 30 秒断网）：住宅配置会话中用户开启 Chrome/Edge Secure DNS，一分钟审计判 blocking 后原代码走保留式拆线——核心停、PF 只留 bootstrap、系统 DNS 仍指向死解析、不排重连（浏览器设置只有用户能改）——整机断网，直到 helper 核心停机看门狗约 30 秒后自行释放。改为显式释放拆线（`disconnect(releaseKillSwitch: true)`，含 DNS 恢复与 disarm），错误文案与 `protectedDnsNotReady` 分类不变，仍不排自动重连。
  - `MAC-PROTECTED-AFTER-PF-RELEASE`（PF 已释放仍显示已保护）：helper 会话中 fail-open（如 `tun_route_rearm` 重装失败即释放并删除意图）后 `/killswitch/health` 回 wanted=false/live=false，而 PF 健康检查只在 wanted=true 时行动，App 的 `isArmed` 闩一直为真，界面与失败路径持续按「PF 在」处理且永不理会。现该状态记 `killswitch_released_under_session` 审计事件、清掉闩、置 `needsSessionExceptionReassert`，由同一 tick 的原位重装块带会话端点重新武装；不拆会话、不限制为 bootstrap，用户经隧道的在线不断。helper 无应答（nil health）保持原行为。
- 新增/优化：无检查放宽；PF fail-closed 契约与 `KillSwitchService.arm` 的未知结果保意图语义不变。
- 工程与测试：`AppState.scanBrowserProtectedDNS` 由方法改为与 `tunInterfaceExists` / `protectionAudits` 同款的系统边界闭包（默认实现即原方法体），监视器 tick 可注入扫描报告。`AppStateCoreMonitorTests` 新增两条回归：浏览器 DoH 冲突必须走到 disarm（不得 restrictToBootstrap）且不排重连；helper fail-open 必须先清闩再原位重装、会话不拆、意图仅由成功重装消费。
- 验证：本机（Linux）无 Xcode/macOS，XCTest 未执行，托管 CI 运行；Swift 仅人工核对了语法、可选与 `try` 及与既有假件（`NetworkProtectionOperations` / `ProtectionAuditOperations` / `KillSwitchService.armIPC`）的调用链。无实机验证。
- 候选/发布：仅源码，无新候选。
- 剩余限制：原位重装持续失败时会话以无 PF 状态在线（macOS 无严格 kill switch 的既定 fail-open 姿态），每 tick 记 `killswitch_heal_reassert_failed` 属既有节奏；`needsSessionExceptionReassert` 在拆线后残留会在下个会话首个 tick 多一次原位重装（既有语义，未改）。#720/#755 亦改 `AppState+Connect.swift`，本分支改动集中在健康监视器两个分支与一个测试边界，便于变基。
