## 2026-10-10 · macOS 更新发现文档经 Tono 中继回退
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，Amp 待办 [A2](../ops/amp-backlog-2026-10-10.md)（macOS 更新器中继回退）；
  macOS 客户端 `apps/macos/Tono/Services/{NativeUpdateDownload,ControlPlanePath}.swift`。服务端、helper、PF 不改。
- 来源：基线 origin/main 4e373f06 → 分支 `amp/a2-updater-relay`，PR #1472；未合 main。
- 缺陷修复：[WIN-AUTH-CN-CF-PATH](../findings.d/WIN-AUTH-CN-CF-PATH.md) 的 mac 更新器侧。待办写的是 Sparkle appcast
  （`Info.plist` 的 `SUFeedURL`），但本工程已不链接 Sparkle（无 `import Sparkle`，`packageProductDependencies` 为空），
  `SUFeedURL` 是遗留键；实际更新器是原生发现 `NativeUpdateDownload`（`releases.afk.ccwu.cc/desktop/v1/` 的
  manifest 与签名），按此实现。原行为：发现 GET 只走系统 DNS，Cloudflare 路径不通的客户检查更新即失败。改后：
  系统 DNS 在任何应答前失败时，同一 GET 按 `TonoAPIClient.exchangeOverPaths` 的顺序再走该主机的固定 IP（只有 API
  主机有，发布主机没有，跳过）与中继 `ControlPlanePath.apiRelays`（新增 `releases.afk.ccwu.cc`，两台中继与 API
  相同，SNI 已在中继放行），复用固定 IP 客户端（SNI 为发布主机名，默认证书校验，无代理、不跟随重定向，响应上限同直连）。
  任何状态行即应答：非 200、超限或正文失败都报错，不再换路。
- 新增/优化：无。中继不进入 `KillSwitchService.configuredBootstrapPins`（PF 放行表），armed 时中继被 PF 拦截；
  manifest 签名仍由 root helper 校验（Sparkle EdDSA 密钥签的 manifest，`verifyUpdateOffer`），未改。
- 工程与测试：一个回归 `NativeUpdateDownloadTests.testDeadDirectPathHandsTheMetadataGetToTheRelay`（直连在应答前被拒，
  固定 IP 未建连，中继应答，返回中继正文；发布主机的生产回退为 `["relay"]`）。
- 验证：本机不跑 xcodebuild；由 hosted macOS CI（ci-gate）在 PR #1472 头 SHA 上运行，run id 与结论记在 PR 评论。
- 候选：仅源码，无新候选。
- 剩余限制：安装包下载（`NativePackageDownload`，URLSession 落盘，900 s）仍只走直连；固定 IP 客户端整包读入内存、
  整次交换 45 s，不适合安装包。Cloudflare 路径不通的客户能发现更新，下载仍会失败。发现 GET 经中继时整次交换上限是
  固定 IP 客户端的 45 s（直连为 30 s）。实机（移动线路）未验证。
