## 2026-10-24 · macOS sing-box 防泄漏规则同源移植
- 归属：SHIP_PLAN §2 item 10；macOS 配置生成；分支 fix/r2-mac-antileak，未合 main。
- 来源：eaab10d49；不重复 #1740 的 IPC/helper 修复。
- 缺陷修复：共享 STUN/海外 UDP、853 拒绝提前至 DIRECT 前；产品 DNS 首条抑制 HTTPS/SVCB。
- 新增/优化：无新模式或 DIRECT 许可；保持 LAN、DHCP、mDNS 与 PF 现有行为。
- 工程与测试：扩展已有同源生成器及 ci-gate 漂移检查，增加逐规则 Node/XCTest；helper 协议版本仅为新图精确准入同步递增。
- 验证：Node 旧图 0/6、修复后 6/6；生成器回归、macOS/iOS/Android 同源检查通过。Swift graph harness 见 PR。完整 XCTest/打包核心 parser 待 CI。
- 候选/发布：仅源码，无新候选、部署或客户发布。
- 剩余限制：WebRTC/STUN、DoT/DoQ 回退、IPv6 双栈和本地发现待 macOS 26 Apple Silicon 真机；详见 docs/reports/2026-10-24-macos-anti-leak-parity.md。
