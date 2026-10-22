| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| ANDROID-X-EXACT-CLOUD-GAP | Android 默认 three-tier 未收录 X 网页/API/媒体精确主机，按默认规则走 DIRECT/本地 DNS | open | 待 draft PR | 中·推导 | 配置缺口待云端引擎回执；用户模式、版本、App/browser、排除项未知，无用户设备因果证据 |

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

拟追加 15 个有官方依据的精确服务主机，见
[provisional decision 132](../decisions/132-2026-10-22-x-exact-cloud-hosts.md)。
权威源为 `tooling/scripts/sing-box/three-tier-template.json` 的 `overseas_full`，
使用现有脚本同步 Android/iOS/macOS；Windows Core/Service 编译同一模板。
不手改 GENERATED，不变更签名策略、版本 2 schema 或默认模式。
macOS helper 精确准入图随之改变，需 4.52.63 → 4.52.64 保证重装。
这是共享分类变更，非 Android 私有热补丁；独立高风险审查尚未运行，禁止合并/部署。

## 验证

待云端原始日志/配置与真实 RED/GREEN 后填入；不以源码推断代替已运行结果。
用户设备、真实 X 服务、排除项、ECH/DoH、QUIC 回退未验证，不声称事故已解决。
