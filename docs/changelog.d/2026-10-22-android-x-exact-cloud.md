## 2026-10-22 · Android X 精确服务云路由缺口
- 归属：ops plan §P2 Android / iOS 客户端；独立 draft，不推进 G4。
- 来源：main `d1f948f88` → `t3/android-x-twitter-routing`，[#1719](https://github.com/raydocs/tono/pull/1719)，尚未合 main。
- 缺陷修复：three-tier 默认的 X 网页/API/图片/视频/短链接精确主机未收录，
  落到 DIRECT/本地 DNS；权威 overseas 表追加 15 个官方服务精确主机，
  TCP 走 cloud、匹配 UDP/ICMP 拒绝，不在失败后回退 DIRECT。
  见 [finding](../findings.d/ANDROID-X-EXACT-CLOUD-GAP.md)。
- 新增/优化：无泛域名、通用 CDN 或包级 X 路由；Grok Home、已有视频优先级、
  AI package pin、stable 模式、签名策略和模式默认值不变。
  [决定 132](../decisions/132-2026-10-22-x-exact-cloud-hosts.md) 为 provisional：
  共享列表同时影响 iOS/Windows/macOS；通过现有脚本生成合同，macOS helper
  4.52.63 → 4.52.64 避免新图配旧准入。未擅自生产变更。
- 工程与测试：一个 Android 路由/DNS/Grok 边界回归；现有真实 sing-box harness
  增加 X/Grok/负例及云停止断流检查，DIRECT 也使用本地 stand-in，避免实网/DNS
  掩盖误路由；不更改生产 emitter 或 fail-closed 规则。
- 验证：Devin Linux 基线 `d1f948f88` 的真实生成配置/引擎确认 X three-tier
  为 DIRECT/local DNS，stable 为 cloud/fake-IP；test-only `300fe0be4` 真实
  RED（`expected Tono-Exit, actual direct`，1 failed，非编译失败）。修复
  `d09c296e3` GREEN：JVM 18/18，0 skipped；四配置 CLI/harness、DNS 192 项及
  A/AAAA 纯数字 fake-IP 映射路由 40 项通过，Grok/断云拒绝边界保持。
  stable 原字节和完整图哈希均不变；三个同步检查、Node 测试（1 pass）通过。
  原始包/JUnit/关键日志/配置与校验清单已下载复核，链接/哈希见 finding。
  最终续记仅 docs，不把 GREEN 改记到未运行的其他 SHA。
- 候选/发布：仅源码，无新候选、签名包、生产部署或客户发布。
- 剩余限制：用户真实设备根因未确认；App/browser/版本、模式、App 排除项待回复。
  Android 实机、真实 X、QUIC 回退、ECH/DoH 未验；macOS/iOS/Windows 原生构建
  与独立高风险审查未跑，draft 不可合并/部署。
