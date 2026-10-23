## 2026-10-23 · 海外 UDP/STUN 防泄漏与 Home/Cloud 名单扩面
- 归属：SHIP_PLAN G1（已连接=能用；海外 UDP/STUN/DoT 不得从物理出口泄漏）；Android / iOS 路由合同、桌面名单源、控制面 traffic-policy 守卫。
- 来源：`origin/main` `12ed2cfa0` → `cursor/routing-udp-stun-anti-leak-f4d5`（`git am` 四段补丁）；未合 main。
- 缺陷修复：三层模式下海外 STUN/UDP/QUIC 与公共 DNS 原始 IP 探测可走物理出口；现拒绝海外 STUN 端口、海外 UDP IPv4/IPv6 CIDR、第三方 STUN/TURN 后缀与 DoT/DoQ 853，国内 UDP 仍直连。稳定模式与三层对 FakeIP / 海外精确主机 / 全部查询预答 DNS HTTPS(65)/SVCB(64)，避免 WebView 向运营商 DNS 泄漏或拿到真实海外 IP + h3 提示。
- 新增/优化：Anthropic/Claude 鉴权、遥测、SSO、人机验证与辅助资源走 Home；X 全域后缀与海外即时通讯/知识/流媒体/开发者生态后缀走 Cloud；Telegram DC IPv4/IPv6 CIDR 走 Cloud TCP 且 UDP/ICMP 拒绝；DNS 未命中走 catch-all 防泄漏。控制面 `directGuardSuffixes` 同步禁止签名策略把这些后缀改成 DIRECT。桌面 `direct_domains.rs` 为名单源，移动端合同由同步脚本生成。
- 工程与测试：Android/iOS 路由单测与 harness 覆盖 STUN/DoT/Home 辅助/X 与海外 Cloud 边界；不改 PF/WFP 特权路径，不引入 `skip-cert-verify`。
- 验证：Linux Cloud Agent 上 `git status --short` 干净；16 个产品文件与附件 tar 逐字节一致。`python3 apps/ios/tools/sync-desktop-routing.py --check` 通过。Android 脚本需要 `--desktop`（与 `android-ci.yml` 相同）：`python3 apps/android/scripts/routing/sync-desktop-routing.py --desktop /workspace --check` 通过。未跑完整仓库构建、Gradle、XCTest、`cargo test`、Worker `npm test`、实机。
- 候选/发布：仅源码，无新候选、签名包、生产部署或客户发布。
- 剩余限制：新名单常量目前由移动端 sing-box 生成器消费；Windows/macOS 运行时尚未引用 STUN/DoT/海外 UDP 拒绝列表。未做真机 STUN/QUIC/IPv6/5G 泄漏对照。路由/防泄漏属高风险，合入前需独立 high 审查。
