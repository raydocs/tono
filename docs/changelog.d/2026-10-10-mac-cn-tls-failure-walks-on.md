## 2026-10-10 · macOS 控制面：系统 DNS 路径 TLS 握手失败或证书被拒时，POST 继续走 pinned / 中继
- 归属：ops 任务（[运维计划](../ops/plan-2026-09-11.md)；中国大陆连通性审计，延续 [Amp backlog](../ops/amp-backlog-2026-10-10.md) A4/A11 与决定 077）；macOS App 控制面客户端。
- 来源：origin/main `3d973f95` → 分支 `amp/cn1-tls-failure-walks-on`；未合 main。
- 缺陷修复（MAC-CN-TLS-POST-STOPS）：系统 DNS 被污染、答案指向出示别人证书的服务器，或网络在 TLS 握手中途重置时，发验证码 / 验证 / 刷新这些 POST
  在系统 DNS 路径就结束（前者报「网络在拦截加密连接」），从不试 pinned 与中继 → 路径链把 URLSession 的 `secureConnectionFailed`
  和信任库拒绝的证书（`ServerCertificateUntrusted` / `HasUnknownRoot`，非日期）视为「请求字节没有离开本机」（TLS 在请求之前），
  POST 交给下一条路径，每条路径最多收到一次。全部失败时归因不变（拦截证据键、时钟优先）。
- 新增/优化：无。重试规则 `shouldRetry`（同一路径的第二次尝试）与时钟归因（#588）不变；pinned / 中继自己的 TLS 失败本来就按「未连上」处理。
- 工程与测试：`AccountSessionRequestTests.testAPoisonedResolverAnswerHandsTheSignInToThePinnedAddresses`、
  `testAHandshakeResetOnTheSystemPathHandsTheSignInToThePinnedAddresses`（模拟：URLProtocol 注入错误，非中国实网）。
- 验证：Swift/XCTest 本机（Linux）不可运行，交由托管 CI（ci-gate）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机。系统 DNS 黑洞（SYN 无应答）导致的 POST 超时仍不会换路径（可能已送达，见后续路径预算改动）；与 #1507（A30）同改 `exchangeOverPaths`，文本冲突时保留两边。
