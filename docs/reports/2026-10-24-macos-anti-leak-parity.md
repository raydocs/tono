# macOS sing-box 防泄漏移植（第二轮）

归属：SHIP_PLAN §2 item 10；仅源码，无新候选。基线 `eaab10d49`。
复核 #1740 已合入，其改动是 IPC、应急恢复等，不包含本次配置规则。
不修改 AppDelegate、HelperManager、PF、KillSwitch、SystemProxy、ReleaseDaemon。

## 按模式对照（修复前 → 本 PR）

| 模式/发出器 | Windows / 移动端参照 | macOS 基线缺口 | 本 PR |
|---|---|---|---|
| Stable / managed DIRECT，`+SingBoxProduct.swift` | Windows `routing.rs:apply_selective_anti_leak_and_routing` 的 DNS hijack 后五条 reject；移动端 DesktopRoutingContract 同源数据 | 末尾拒绝 UDP/ICMP，但 reviewed app/web DIRECT 可先放行；TCP 853 未统一拒绝 | 五条共享 reject 放在 port 53 hijack 之后、所有 DIRECT 前；保留原有末尾拒绝 |
| Three-tier，`ThreeTierRoutingContract.graph` | Windows `three_tier.rs` 的五条 reject | 全局 IPv6 拒绝和末尾拒绝不能取代靠前的端口/后缀/CIDR 保护 | 生成模板中 DNS hijack 后插入五条 reject；不移除全局 IPv6 拒绝 |
| AI Home，同上 `.aiHome` | 同一份 Windows STUN/海外 UDP 契约数据；macOS 模式边界见决定 130 | 非 AI 流量默认 DIRECT，公共 STUN/raw-IP 海外 UDP 可直连 | 仅增加明确列出的端口、后缀、海外 CIDR 拒绝，不把普通 UDP 改成全局拒绝 |
| 产品三模式的 DNS | 本任务明确要求 HTTPS(65)/SVCB(64) 阻断；共享域名/IP 列表不定义 DNS 类型 | AAAA 抑制不阻止 HTTPS/SVCB 携带地址提示 | 首条 DNS 规则以 NOERROR 空答复抑制 type 65/64，先于真实 DNS/FakeIP/域名规则 |
| `+SingBox.swift` 离线 M1 draft | 冻结 reference.json，不是产品调用路径 | 已全局拒绝 IPv6、UDP/ICMP；无 DIRECT | 跳过：保持冻结离线评估契约，不将产品变更混入合成 draft |
| `ConfigPipeline.swift` | 已生成 Home/video 域名 | 此处无产品 sing-box 规则发出器 | 无需改动其已有域名数据 |

五条规则依次为：全部网络端口 853；UDP/ICMP 19302–19309；UDP/ICMP
PUBLIC_STUN_SUFFIXES；UDP/ICMP OVERSEAS_UDP_REJECT_IPV4_CIDRS；IPv6 UDP/ICMP
OVERSEAS_UDP_REJECT_IPV6_CIDRS。与 Windows 的字段与顺序一致。

## 同源与边界

扩展现有 `sync-routing-domains.mjs`，从 Windows `direct_domains.rs` 提取有界数组；
不手抄产品常量、不改 Windows/移动端行为。`--check` 已在 ci-gate 中，现同时检查
五条规则数据以及两份 macOS 模板。产品 Stable 从同一生成块读取规则。
HTTPS/SVCB 类型是协议常量，不伪称其它端已有完全同形的 DNS 规则。

新规则不覆盖普通国内 UDP、DHCP 67/68、mDNS 5353 或私网地址段；现有 LAN 开关、
TUN route exclusions、节点 outbound、控制面和住宅连接构造均不改。853 的拒绝有意包含
局域网 DoT/DoQ，以回退到已劫持的普通 DNS；不增加任何 DIRECT 许可。
AI Home 只增加本任务明确指定的海外列表/端口防泄漏，不改变 PF 的 AI-only scope。

`ThreeTierRoutingContract` 同时编入 root helper，其 admission 按图精确匹配。
因此仅把 HelperProtocolVersion 4.52.67 → 4.52.68，强制新 App 在发出新图前升级匹配的
helper；否则旧 helper 会拒绝新图。不修改 helper/PF 实现或权限、放行范围。

## 回归与剩余限制

- Node 六个行为测试在旧图上 0/6、修复后 6/6；生成器现有拒绝歧义/漂移测试保持通过。
- TonoTests 每条新规则各一个 XCTest，检查 Stable 产品输出与两个 graph 的顺序；
  DNS 单独检查首条规则。数据完整性由 Node 对真实 Rust 数组逐项对照。
- Swift 独立 graph harness 对同一基线文件和修复文件执行，不修改旧源码；结果见 PR。
- 完整 TonoTests / packaged parser 未本地执行：本 worktree 缺少 Resources/sing-box；
  本机磁盘一度仅 141 MiB，不下载/构建核心，不清理他人缓存。交由 hosted macOS CI。
- 真机：macOS 26 Apple Silicon（实际安装候选）验证三模式 WebRTC/STUN、
  Chrome/Safari 泄漏页、强制 DoT/DoQ 应用 853 回退、双栈 IPv6 和仅 IPv4 网络；
  对照国内 UDP、DHCP 续租、mDNS/AirDrop、节点/控制面可用性。未声称已实测。

## 可复现命令与原始回执

原始回执：`docs/agent-reports/2026-10-24-r2-mac-antileak/`。
Node：`node --test tooling/scripts/tests/macos-anti-leak.test.mjs tooling/scripts/tests/routing-domains-sync.test.mjs`。
RED 在修改源码之前运行，六项均为缺少规则/首条 DNS 类型不符的断言失败（非编译失败）。
Swift RED 使用 `git show eaab10d49:apps/macos/Tono/Core/ThreeTierRoutingContract.swift`；
GREEN 使用当前同路径文件。各自在前面加 `import CoreFoundation`，后面拼接
`tooling/scripts/tests/macos-anti-leak-graph.swift`，保存到临时 `.swift`，再执行：
`swift -swift-version 6 -strict-concurrency=complete <temporary.swift>`。
RED exit 1（12 FAIL），GREEN exit 0（12 PASS）；这是独立 graph 执行，不是 TonoTests 通过证据。
`git merge origin/main` 快进至 `88a8f2561` 后重跑：Node 7/7、Swift 12/12、
macOS/iOS/Android 漂移检查和 `git diff --check` 均通过；该 main 增量未改本任务 macOS 文件。
