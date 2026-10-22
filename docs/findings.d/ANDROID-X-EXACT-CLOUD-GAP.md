| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-X-EXACT-CLOUD-GAP | Android 默认 three-tier 未收录 X 网页/API/媒体精确主机，按默认规则走 DIRECT/本地 DNS | in-PR | [#1719](https://github.com/raydocs/tono/pull/1719) | 中·已确认（配置层） | 用户模式、版本、App/browser、排除项未知，无用户设备因果证据 |

## 链路与边界

- 控制面 `services/control-plane/src/index.ts` 分别提供 `exit-catalog` 和
  `traffic-policy`；后者的 `publicTrafficPolicy` 验证摘要、可配置的 Ed25519
  签名和内嵌 revision，返回独立 envelope。Android **mobile** 当前不是桌面的
  签名策略消费者：`TonoVpnService.loadCatalog` 只请求 exit-catalog，
  `CatalogAdmission.admit` 校验 YAML/routing 摘要、节点和 Home 绑定；随后
  `startCore` 使用 `ConfigInput` 和内置 `DesktopRoutingContract`。没有把
  “grep 没有 X”误写成生产签名策略错配，也未改远程签名策略或准入。
- `EngineSettings` 默认 THREE_TIER，但已保存的 STABLE 不被改写。three-tier
  final 为 direct，未命中的 A/AAAA 使用 underlying-network local resolver；
  无全局 IPv6 时未命中的 AAAA 为空。stable final 为云，公网 UDP/ICMP 拒绝，
  公网 A/AAAA 全部 fake-IP，LAN 和本地 DNS 名保留。
- `SingBoxConfig` sniff → DNS hijack → 视频 → Home suffix/CIDR/AI package →
  protected/海外精确云表 → stale fake-IP reject → LAN → final。fake-IP
  `198.18.128.0/17`、`fc00::/18` 的存储和名称恢复、sniff HTTP/TLS/QUIC
  让域名规则生效；它们本身不会把未分类的 X 变成云路由。已分类 UDP/QUIC
  拒绝而非退回 DIRECT；客户端是否真正回退 TCP 仍需设备验证。
- `com.twitter.android` 不是 Home AI package，不增加整包 pin。`ai.x.grok`
  的现有整包 Home 与域名 `grok.x.com`（含子域）、`grok.com` 保持不变；
  已有视频例外仍优先于 AI package。没有新增 X 父域 Home 规则。
- `EngineSettings.excludedPackages` 默认空；`startCore` 将用户选择传入
  `OverrideOptions.excludePackage`，`BoxPlatform.openTun` 调用
  `VpnService.Builder.addDisallowedApplication`。排除的 X 或浏览器完全绕过
  TUN；改域名列表不能修复这种设置，且本次不覆盖用户选择。
- 无 fake-IP mapping、无可 sniff 名称的 raw-IP/DoH/ECH 流量仍受原模式
  final 约束；不通过全 CDN、IP 段或包级规则假装解决未知设备流量。

## 修复范围与跨平台

已追加 15 个有官方依据的精确服务主机，见
[provisional decision 132](../decisions/132-2026-10-22-x-exact-cloud-hosts.md)。
权威源为 `tooling/scripts/sing-box/three-tier-template.json` 的 `overseas_full`，
使用现有脚本同步 Android/iOS/macOS；Windows Core/Service 编译同一模板。
不手改 GENERATED，不变更签名策略、版本 2 schema 或默认模式。
macOS helper 精确准入图随之改变，需 4.52.63 → 4.52.64 保证重装。
这是共享分类变更，非 Android 私有热补丁；独立高风险审查尚未运行，禁止合并/部署。

## 验证

[Devin Linux session](https://app.devin.ai/sessions/ca8e2c3dd1974ec6a641199cfd956511)，
[原始证据包](https://app.devin.ai/attachments/4c82e30f-318f-43bd-b728-6cea446a97e7/x-routing-evidence.tar.gz)
SHA-256 `1841d78af4c096db21f7b5b2f9f568db81937a5c80897485fc6da0e90d7b6ca4`。
包内保留三阶段 SHA、原始日志/JUnit、脱敏实际配置、独立临时探针脚本和校验清单；
本任务已下载逐项复核关键日志、JUnit、配置差分与包内 SHA256SUMS，而非只接受 verifier 结论。

- 基线 `d1f948f88efd4e778b92f0df44b3b1f4a0a5ae82`：实际运行
  `ConfigSnapshotWriter` 生成四份配置，CLI 全通过。真实 pinned sing-box
  18-host 探针中 `x.com`、`api.x.com`、`api.twitter.com`、`abs.twimg.com`、
  `pbs.twimg.com`、`video.twimg.com`、`t.co` 在 three-tier 为 direct，stable
  为 cloud，`grok.x.com`/`grok.com` 均为 home。实际 DNS 有序规则匹配显示
  three-tier X 为 local，stable 为 fakeip；没有把本地解析器的真实可达性
  冒充已验（探针在只有 loopback 的 network namespace）。
- **RED** `300fe0be49d0daf51e97f8b492149263576a427b`：新回归在旧合同真实运行，
  `RoutingPolicyTest.kt:61` 报
  `org.junit.ComparisonFailure: expected:<[Tono-Exi]t> but was:<[direc]t>`；
  `1 test completed, 1 failed`、`BUILD FAILED in 12s`，非编译失败或 skipped。
- **GREEN** `d09c296e3cd71b3f57bbac3d2448a7917e8d687f`：
  `./gradlew --no-daemon :routing:testDebugUnitTest --rerun-tasks`，
  `BUILD SUCCESSFUL in 14s`；JUnit 18 tests / 0 failures / 0 errors / 0 skipped，
  含同名新回归。四份配置均通过 pinned `1.15.0-alpha.12` CLI 与更新后的
  engine harness（50/48/48/50 条输出），包括云停止后 X/Grok 失败而非 DIRECT。
- 四配置的生成 DNS 规则检查 192 项（其中 X A/AAAA 120 项）通过；额外真实
  引擎 DNS hijack → fake-IP → 纯数字 IPv4/IPv6 SOCKS ATYP 1/4 连接探针
  共 40 次查询、40 次映射路由通过，HTTP Host 使用数字地址而非原名称，
  `DIRECT_STUB_REQUESTS=0`，X 为 cloud、Grok 保持对应 Home/未绑定云。
  该探针未改生产 route/DNS 规则，仍不等于真实 Android TUN 或 QUIC 回退。
- 完整 stable 配置原字节 SHA-256 前后均为
  `09b0fc5830bfb2b0d710eaf604f22312a575237cdf76302749fc8982d1e4219c`，
  canonical graph SHA-256 前后均为
  `0c25bf236b65fa81dcf832e3512674df1772a0842495c584bdb2c30b74cb4cc0`；
  本任务另比较了完整脱敏配置相等。stable IPv6-off 只有规则顺序分析，
  不声称独立 runtime fixture 已跑。
- 本地与云端三个同步检查及同步器 Node 回归（1 pass）通过。
  源码/实际 Android 图除 15 个 exact host 追加外不变；两个 macOS 生成图同样
  只追加该表，不改变 Home/video 优先级、DNS 服务器或 actions/order。
- 未运行/未验收：独立高风险审查、macOS/iOS/Windows 原生套件、Android
  emulator/实机/签名构建；未等待或监控 PR CI。最终记录提交仅 docs，产品验证
  覆盖上列 GREEN SHA，不将其改写成其他 SHA 上的运行结果。
用户设备、真实 X 服务、排除项、ECH/DoH、QUIC 回退未验证，不声称事故已解决。
