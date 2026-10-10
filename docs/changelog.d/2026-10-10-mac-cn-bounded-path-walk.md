## 2026-10-10 · macOS 控制面：系统 DNS 路径不再拖住 pinned / 中继（读请求 15 s 预算；POST 超时后重试改走握手成功的路径）
- 归属：ops 任务（[运维计划](../ops/plan-2026-09-11.md)；中国大陆连通性审计，延续 [Amp backlog](../ops/amp-backlog-2026-10-10.md) A4 与决定 077）；macOS App 控制面客户端。
- 来源：origin/main `3d973f95` → 分支 `amp/cn2-bounded-path-walk`，[#1523](https://github.com/raydocs/tono/pull/1523)；未合 main。
- 缺陷修复（MAC-CN-SYSTEM-PATH-HOLDS-WALK）：
  - 系统 DNS 答案指向丢包地址时，读请求要等 URLSession 30 s / 45 s 超时才轮到 pinned 与中继 → 后面还有路径时，读请求在系统 DNS 路径上
    最多等 15 s 状态行（`ControlPlanePath.systemHeadBudget`，`exchangeWithinHeadBudget`），之后按普通传输失败交给下一条路径；状态行到了以后的 body 读取不受此限。
  - 同样情况下的 POST 超时（可能已送达）仍不换路径、不重发 → 改为立即对每条路径做一次 A4 式 TCP+TLS 握手探测（不发 HTTP 请求、不带身份），
    用户重试时先走握手成功的路径，不再白等同一条死路径。
- 新增/优化：[docs/ops/api-relay.md](../ops/api-relay.md)「Client behaviour」写明 macOS 登录各路径预算（读请求最迟 25 s 到中继；POST 规则）。
- 工程与测试（模拟，非中国实网）：`AccountSessionRequestTests.testASilentSystemPathHandsAReadToThePinnedAddressesWithinTheHeadBudget`、
  `testASignInPostThatTimedOutOnTheSystemPathSendsTheRetryToAPathThatHandshakes`；另补现有行为的覆盖
  `testASilentFirstRelayLeavesTheSecondRelayTheRestOfTheConnectBudget`（两个本机回环监听器：第一个只收 TCP 不回 TLS，第二个随即关闭；
  验证第二个中继在 2 s 连接预算内被拨到）。
- 验证：Swift/XCTest 本机（Linux）不可运行，交由托管 CI（ci-gate）。
- 候选/发布：仅源码，无新候选。
- 剩余限制：未实机。POST 第一次仍要等系统 DNS 路径的会话超时（最长 45 s）才报错，这是「不重发可能已送达的请求」的代价；首登由 A4 启动探测兜底。
  与 #1507（A30，按路径取 PF 窗口租约）同改 `exchangeOverPaths` 的尝试调用处，文本冲突时两边都保留（租约包住本改动选出的那次调用）。
