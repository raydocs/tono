## 2026-10-10 · macOS 受保护时登录失败：明确说明要关保护才能在这个网络登录，以及关保护意味着什么
- 归属：ops 任务（[运维计划](../ops/plan-2026-09-11.md)；中国大陆连通性审计）；macOS App 登录文案。叠在 [#1528](https://github.com/raydocs/tono/pull/1528)（路径逐条归因）上。
- 来源：分支 `amp/cn3-unreachable-names-paths` → 分支 `amp/cn4-protected-signin-copy`；未合 main。
- 缺陷修复（MAC-CN-PROTECTED-SIGNIN-UNEXPLAINED）：保护已 armed、没有隧道时登录失败只说「无法连接」→ 控制面不可达（`APIError.unreachable`）且登录门的
  断网屏障仍在（`AppState.gateProtectionNotice` 非 nil、不是只剩 AI 恢复规则、未连接；新注入 `gateProtectionHoldsConsumer`）时，
  错误文案第三句改为「保护正在开启，只放行 Tono 固定地址，所以 Tono 中继和其他路径在这台 Mac 上都被拦住。要在这个网络上登录，请用「恢复正常网络」关闭保护：
  这台 Mac 会改用普通网络、不受保护，直到你再次连接。Tono 不会自行关闭保护。」（中英）。`AccountSession.fail` 与登录方式读取都走新的 `accountErrorMessage`。
- 新增/优化：无。不释放、不改 PF / helper；按钮与界面结构不变（登录卡片下方已有「恢复正常网络」）。
- 工程与测试：`AccountSessionRequestTests.testAnUnreachableSignInWhileProtectionHoldsSaysSigningInNeedsProtectionOff`（模拟：所有路径连不上、屏障在；断言文案带关保护说明与中继，且 `killSwitchDisarmConsumer` 未被调用）。
- 验证：Swift/XCTest 本机（Linux）不可运行，交由托管 CI（ci-gate）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机。A30（#1507）把常驻放行改为按尝试开的短窗口后，文案仍成立（中继不在放行表）。
