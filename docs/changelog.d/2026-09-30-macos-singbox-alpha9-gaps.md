## 2026-09-30 · macOS sing-box 产品路径对齐 chrome、fake-IP 和顺序 DoH
- 归属：ops 计划（sing-box 分阶段，不是客户发布门）；影响 macOS 产品发出器、DNS 探测和 `/delay` 门闩。不改 PF、不改助手、不改冻结的 M1 草稿。
- 来源：PERF-CONNECT-4（#741/#742）。基线 `d2363002`；分支 `cursor/singbox-macos-alpha9-gaps-01d4`；未合 main。
- 缺陷修复：产品发出器接受非 chrome 指纹，fake-IP 仍是 `198.19.0.0/16`，只有一个 DoH，fake-IP 应答会按 alpha.9 的 600 秒缓存。现在空指纹写成 chrome，其它指纹不发出；选中节点不是 chrome 时整份配置失败，核心不起。fake-IP 为 `198.18.16.0/20`，A 路由 `rewrite_ttl` 为 30。主 DoH 不是 NOERROR 才问 `8.8.8.8`（SNI `dns.google`），两条都走出口且只协商 h2。没有明文 DNS。
- 新增/优化：`/delay` 在数据面证明前不发 HTTP。跳过的结果不当成出口失败，因此成功的 TUN 不会因为没取样而断开。节点切换在重载前关上这道门，证明之后才重新打开。停止核心后尽力执行 `dscacheutil -flushcache`，不等待、不因失败改变停止结果，也不动助手。探测仍把 `198.19` 当成 fake-IP，避免旧缓存被当成公网地址；`198.18.0.1` 和 `198.18.0.2` 不是。
- 工程与测试：`testProductRuntimeRequiresChromeAndSequentialDoH`。冻结草稿的指纹测试不改。
- 验证：本机不能跑 XCTest。alpha.9 `sing-box check` 已接受同一 DNS 形状（见认证夹具）。Mac Studio 浸泡未做。
- 候选/发布：仅源码，无新候选。安装针仍由 #730 单独移动，需要 Mac Studio 浸泡后才能当发布候选。
- 剩余限制：`rewrite_ttl` 是否真被 macOS 缓存 30 秒、无特权的 `dscacheutil` 能否清掉 mDNSResponder，都要实机。进程崩溃时这个刷新跑不了，仍靠现有的失败打开把 DNS 交回系统；严格 Kill Switch 只有用户明确打开才保持拦截。生产 DoH 是否一次握手没有在这台机器上对着 `1.1.1.1` 量过。NXDOMAIN 会再问备份。`default_domain_resolver` 只拨主 DoH。
