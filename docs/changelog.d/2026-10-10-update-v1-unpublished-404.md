## 2026-10-10 · v1 更新渠道未发布（发现清单 404）时两端报「无更新」而不是检查失败
- 归属：运维计划 [plan-2026-09-11](../ops/plan-2026-09-11.md)，协调方指派的发布主机 404 排查（Amp 待办 2026-10-10 夜间批次）；
  macOS `apps/macos/Tono/{Services/NativeUpdateDownload,App/AppUpdater}.swift`、Windows
  `apps/windows/app/src-tauri/src/tono/commands/update.rs`。服务端、helper/Service、PF/WFP 不改，`HelperProtocolVersion` 不变。
- 来源：基线 origin/main 3d973f95 → 分支 `amp/releases-manifest-404`；未合 main。
- 排查结论：`https://releases.afk.ccwu.cc/desktop/v1/latest/manifest.json` 今天 404 是因为 v1 渠道尚未发布（G4 前预期），
  不是路径/路由错配：404 带 latest 路由才加的 `cache-control: no-store`，说明 Worker 命中路由、R2 无此对象；同一 R2 绑定的
  `/download/…` 正常；客户端、Worker、`desktop-update-v1.mjs` 的布局一致。旧渠道 `windows/latest.json`、`appcast.xml` 均 200。
  未发布、未改任何客户渠道。见 [UPDATE-V1-UNPUBLISHED-404](../findings.d/UPDATE-V1-UNPUBLISHED-404.md)。
- 缺陷修复：原行为：发现清单 404 被当成检查失败：macOS 手动检查弹「Update not completed」；Windows 手动检查提示
  「Couldn't check for updates」，后台检查缓存错误后改为每小时重查。改后（[决定 087](../decisions/087-2026-10-10-unpublished-update-channel-is-no-update.md)，
  provisional）：只有发现对象本身的 404 视为「无更新」：macOS 后台静默、6 h 节奏不变，手动检查提示「No update available」
  （不说「已是最新」）；Windows 返回无报价，SWR 维持每日检查，手动检查显示已有的「已是最新版」。经中继时同样处理
  （中继透传 TLS，404 是发布主机自己的应答，且不会再发给下一台中继）。已发布清单的签名/安装包 404、其他非 200、
  重定向、超限或无效元数据仍是错误。
- 新增/优化：mac 新增两条文案（含简体中文）；`UPDATE_INTEGRATION_V1.md` 的「Missing or mismatched metadata」一句加上这个例外。
- 工程与测试：macOS `NativeUpdateDownloadTests.testUnpublishedDiscoveryManifestIsNoUpdateDirectlyAndOverTheRelay`
  （本机回环 404 直连、以及直连拒绝后中继回 404，两者都得到 nil，中继只收到清单 GET）；Windows
  `update_relay_tests::an_unpublished_discovery_manifest_over_a_relay_is_no_update`（直连拒绝、第一台中继回 404：
  `discovery_document` 为 `None`，第二台不被尝试，偏好记为第一台）。
- 验证：本机不跑 xcodebuild / Windows cargo；由 hosted macOS、Windows CI（ci-gate）在 PR 头 SHA 上运行。
- 候选：仅源码，无新候选。
- 剩余限制：客户在用的旧渠道（Sparkle appcast、`windows/latest.json`）不受影响；v1 渠道何时发布由所有者 G4 决定。
