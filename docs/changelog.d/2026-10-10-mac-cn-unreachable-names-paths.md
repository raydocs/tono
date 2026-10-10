## 2026-10-10 · macOS 登录失败文案写明试了哪些路径、各自怎么失败（直连 / 固定地址 / 中继）
- 归属：ops 任务（[运维计划](../ops/plan-2026-09-11.md)；中国大陆连通性审计，与 [Amp backlog](../ops/amp-backlog-2026-10-10.md) A3（Windows #1478 草稿）的路径列表对齐）；macOS App 控制面客户端与登录文案。
- 来源：origin/main `3d973f95` → 分支 `amp/cn3-unreachable-names-paths`；未合 main。
- 缺陷修复（MAC-CN-UNREACHABLE-NO-WHERE）：所有控制面路径都失败时只显示「无法连接 Tono 服务，请检查网络后重试。」→
  `exchangeOverPaths` 抛错时在 `userInfo` 带上每条路径的标签与失败类别（`ControlPlanePathTimeline.failureClass`：dns / connect / tls / timeout / other，
  与 A19 时间线一致，不读系统本地化文字）以及「是否因可能已送达而停在中途」；`handleTransportFailure` 据此抛新的 `APIError.unreachable(ControlPlaneUnreachable)`
  （时钟、TLS 拦截的归因优先级不变；离线准入仍当作「收到状态行之前失败」）。文案三段：
  第一句（登录卡片标题）说「所有路径都没连上（包括 Tono 中继）」或「服务没有及时应答，为免重复提交没有改走其他路径」；
  第二句「已尝试：直连（域名解析失败）、Tono 固定地址（连不上）和 Tono 中继（连不上）。」；第三句给可操作的提示
  （换一个网络如手机热点后重试、选中这段文字发给 Tono 客服；直连域名解析失败时点明「这个网络的 DNS 没有返回 Tono 的地址」）。中英文案同步（zh-Hans）。
- 新增/优化：无界面结构或视觉改动（文字出现在现有错误卡片与「显示详情」里，详情可选中复制）。
- 工程与测试：新增 `AccountSessionRequestTests.testAnUnansweredSignInNamesEveryRouteItTriedAndHowEachFailed`（模拟：系统 DNS 解析失败、固定地址与两个中继都连不上）；
  `testEveryPathFailureIsNamedWhenNoPathAnswers` 改从 `.unreachable` 读每条路径的原始失败文本（行为不变）。
- 验证：Swift/XCTest 本机（Linux）不可运行，交由托管 CI（ci-gate）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机。受保护（PF 已 armed、无隧道）时中继被 PF 拦住、需要关保护才能登录的说明在后续叠加 PR 里；只有一条路径的客户端（调试 base URL）仍是原通用句。
