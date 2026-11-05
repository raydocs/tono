## 2026-11-04 · 桌面三层模式始终允许局域网／内网
- 归属：G1；macOS app／helper、Windows Core／Service、共享路由合同。
- 来源：基线 [519afda](https://github.com/raydocs/tono/commit/519afda44d81d79ff48a5ccca8135e8ff2dd5e4e)；工作分支 `wip/desktop-three-tier-lan`，未操作 PR、未合 main。
- 缺陷修复：三层模式拒绝 LAN → 始终允许固定 LAN 集合；包括 Core DIRECT 和 Core 死亡后持有阻断的状态。
- 新增/优化：所有者接受新增 `100.64/10`；Stable 开启、AI Home、三层模式共用地址表。Stable／三层模式保留 LAN DNS 53／853 阻断；macOS AI Home PF 只持有 AI CIDR，不新增 LAN DNS／分片阻断，AI Home 图不新增 LAN 53／853 拒绝行，Core 死亡后普通 DNS 与网络不被锁住。三层公网 DIRECT 仍限 IPv4 TCP 80/443；Home／cloud 与海外防漏边界不变。
- 工程与测试：从共享模板重新生成桌面合同及移动端镜像；移动端运行路由不改。新增路由、PF、WFP 与 AI Home Core 死亡后普通 DNS 回归；helper 协议升至 4.52.70，按所有者授权通过文档构建机制刷新源合同，不提交 helper 二进制。
- 验证：macOS arm64 VM；基线新图回归失败，改后 6／6 通过；新 strict PF 三项基线 FAIL、改后 PASS。完整检查与准确最终源码结果以本会话交付证据为准；这些开发期结果不冒充最终 SHA 验收。
- 候选/发布：仅源码，无新候选、无签名包、无部署或发布。
- 剩余限制：XCTest 缺少固定 sing-box 资源；Android 插件解析失败，留待 hosted CI。真实 Mac／Windows 局域网、Core 死亡、Stable／三层 LAN DNS 阻断、AI Home 普通 DNS 连通与 Tailscale 同伴待实机验收；完整源码检查结果以最终 SHA 交付证据为准。
