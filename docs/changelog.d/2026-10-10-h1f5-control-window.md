## 2026-10-10 · H1-F5：macOS 控制面放行只在交换期间存在（≤ 15 s）
- 归属：ops 计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp 待办 A30（[amp-backlog-2026-10-10](../ops/amp-backlog-2026-10-10.md) §6，D4-A）；macOS helper、macOS app。
- 来源：origin/main `681f1e6f` 起，分支 `amp/a30-bootstrap-window`，PR [#1507](https://github.com/raydocs/tono/pull/1507)；未合 main。
- 缺陷修复：H1-F5 macOS 一半。以前保护开着而没有隧道时（连接前的引导、断网保护），helper 的 PF 一直放行 API 主机的固定地址（TCP 443，
  root 与当前用户 UID），同 UID 的非 Tono 进程在断网保护期间可到达共享 anycast。现在这条放行只在控制窗口内渲染：
  `TonoAPIClient` 每次交换前向 helper 取窗口（`POST /killswitch/control-window`），交换应答、失败或取消后立即归还
  （`/killswitch/control-window/close`）；helper 在窗口打开 15 s 后自行撤回（加入的交换不延长），睡眠时随紧急全封一起撤，
  有隧道时不渲染；撤回按地址杀 PF 状态，窗口内建立的连接不会留下。撤回失败每秒重试，连续 3 次失败改装紧急全封。
  helper 重启时若留下的是无隧道规则，1 s 后按持久状态重载去掉放行。Tailscale 控制主机的放行不变。
  H1-F5 记为 accepted-design（已知风险，窗口 ≤ 15 s），见决定 [086](../decisions/086-2026-10-10-h1f5-control-window.md)。
- 新增/优化：helper 协议 4.52.44 → 4.52.45（两条新路由，更新进行中也允许，因为只比以前更窄）；窗口内的交换先
  `URLSession.flush()`，避免复用上个窗口被杀掉状态的连接。
- Windows：未改。Service 的 bootstrap API 通道已绑定 Tono 程序 AppId（#334），非 Tono 进程任何时候都不匹配；加计时需要
  新的 Service IPC 修订且不缩小 H1-F5 暴露面（决定 086）。
- 工程与测试：helper `--self-test` 新增 `runControlWindowSelfTest`（交换期间存在、成功后/失败后/硬上限后不存在、
  重叠交换、不延长、旧租约不能关新窗口、隧道旁不渲染、关闭按地址杀状态）；既有自测改为在窗口内断言 API 放行、
  隧道规则禁止 API 放行；生命周期自测改用 Tailscale 控制主机覆盖 `tono-control` 标签。XCTest
  `testTheControlWindowIsHeldOnlyWhileAnExchangeRuns`。CONTRACT.sha256 更新。
- 验证：Linux orb 只做源码检查；Swift/helper 自测与 XCTest 由托管 macOS CI 运行（见 PR 的 ci-gate）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：窗口内（≤ 15 s）同 UID 进程仍可到达共享 anycast 的 TCP 443（PF 无程序身份）；交换超过 15 s 时失去放行、
  按失败处理；helper 在有隧道的会话中重启时不重载规则（已连接的 arm 本来就不带 API 主机）；未实机验证。
