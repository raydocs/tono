# macOS sing-box 防泄漏规则顺序与门禁复核

归属：SHIP_PLAN §2 item 10；仅测试门禁与文档对齐，不修改 AppDelegate、HelperManager、PF、KillSwitch、SystemProxy、ReleaseDaemon。

## 按模式边界（对齐 `#1820`、`#1822` 与 Decision 130）

| 模式/发出器 | 同源数据来源 | 规则顺序与边界约束 | 门禁覆盖 |
|---|---|---|---|
| Stable / managed DIRECT（`ConfigPipeline+SingBoxProduct.swift`） | `direct_domains.rs` → `sync-routing-domains.mjs` 生成 `ConfigPipeline.swift` 常量 | 端口 53 `hijack-dns` 之后、所有 `action == "route"`（含 reviewed app/web DIRECT）之前依次拒绝 `853`、`STUN_UDP_PORTS`、`PUBLIC_STUN_SUFFIXES`、海外 IPv4/IPv6 UDP；Continuity 本地 IPv6（`fe80::/10`、`fc00::/7`、`ff00::/8`、`::1/128`）仍先于末尾公网全局 `ip_version: 6` 拒绝，且海外 IPv6 CIDR 不覆盖任何本地段 | `macos-anti-leak.test.mjs` + `SingBoxConfigTests` |
| Three-tier（`ThreeTierRoutingContract.graph` `.threeTier`） | `three-tier-template.json` + `direct_domains.rs` 生成 `templateJSON` | `853` 拒绝先于全部 `route`（含 `#1822` 逻辑 LAN 放行）；两条逻辑 LAN `route` 显式排除 `PUBLIC_STUN_SUFFIXES` 等受保护域名；STUN 端口/后缀与海外 IPv4/IPv6 UDP 拒绝先于全部非 LAN `route` | `macos-anti-leak.test.mjs` + `SingBoxConfigTests` |
| AI Home（`ThreeTierRoutingContract.graph` `.aiHome`） | `ai-home-template.json` + `direct_domains.rs` 生成 `aiHomeTemplateJSON` | 按 Decision 130 保持普通非 AI UDP（含 853/STUN 端口）不过滤直连；每条 `Tono-Home-Residential` TCP 路由紧跟同前缀/CIDR 的 `["udp", "icmp"]` 拒绝 | `macos-anti-leak.test.mjs` + `SingBoxConfigTests.testAIHomeSnapshotKeepsAIOnHomeAndSendsTheRestDirect` |
| 三模式客户端 DNS | `["HTTPS", "SVCB"]` `predefined` `NOERROR` | `Tono-DNS` / `Tono-TUN` / `Tono-Mixed` 客户端入站在任何上游真实 DNS 解析器之前抑制 `HTTPS`/`SVCB` 地址与 h3 提示 | `macos-anti-leak.test.mjs` + `SingBoxConfigTests.testHTTPSAndSVCBAreSuppressedBeforeDNSResolvers` |

## 验证命令

- Linux 快速门禁（已接入 `.github/workflows/ci-gate.yml` `Desktop routing-domain contract`）：
  `node --test tooling/scripts/tests/routing-domains-sync.test.mjs tooling/scripts/tests/macos-anti-leak.test.mjs && node tooling/scripts/sync-routing-domains.mjs --check`
- 移动端同源漂移检查：
  `python3 apps/ios/tools/sync-desktop-routing.py --check && python3 apps/android/scripts/routing/sync-desktop-routing.py --desktop . --check`
- macOS 原生单测（`macos-26` CI 执行）：
  `SingBoxConfigTests`（含新增 6 项防泄漏顺序测试及 `testAIHomeSnapshotKeepsAIOnHomeAndSendsTheRestDirect`、`testContinuityLocalBypassDoesNotForcePublicAppleTrafficDirectWithoutPolicy`）。
