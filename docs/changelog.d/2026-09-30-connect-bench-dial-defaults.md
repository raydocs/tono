## 2026-09-30 · 连接拨号默认值与本地基准

- 归属：SHIP_PLAN 客户连接路径（源码）。不是 G4 发布，不改 TUN / PF / WFP / 路由。
- 来源：main `d2363002` → 本分支；未合 main。
- 缺陷修复：目录省略 `client-fingerprint` 时，mihomo 对 Reality 报 `REALITY is based on uTLS, please set a client-fingerprint` 并重试到预算耗尽。运行时在省略时补 `chrome`，目录里写明的值保持不变。证书校验仍开，`skip-cert-verify` 不出现。
- 新增/优化：拥有的运行时增加 `tcp-concurrent: true` 与 `dns.ipv6: false`。Windows `find-process-mode` 仍是 `always`。DoH 仍走出口，不改成明文 DNS。不发出 hy2 `handshake-timeout`。
- 工程与测试：`tooling/perf/connect-bench` 在回环上对比 Tono 旧形状、修正形状和直连 DNS 的 Clash 形状（mihomo v1.19.30，sing-box 1.14.2）。`--check` 对照 `baseline.json`。工作流 `connect-bench.yml`。
- 验证：本机 `python3 tooling/perf/connect-bench/bench.py --check` 退出码 0（2026-09-30，5 次中位数）。VLESS 无指纹：失败，伪装握手 12。修正后首包 45.1 ms，Clash 43.3 ms，各 1 次 Reality 握手。DoH 88.3 ms（1 次握手），Clash 明文 DNS 0.7 ms（0 次）。Hysteria2 首包 2.4 ms / Clash 3.5 ms；DoH 46.6 ms / 明文 0.6 ms。核心启动都约 22 ms，配置生成 < 0.01 ms。连接期间并行 `/delay`：首包 71.7 ms、2 次握手。Trojan 2.6 / VMess 1.1 / Shadowsocks 1.3 / TUIC 3.0 ms，仅 Clash，Tono 不接纳这些协议。`cargo test` 与 XCTest 未跑：本机 rustc 1.83 不能编 edition 2024，且没有 Xcode。
- 候选/发布：仅源码，无新候选。
- 剩余限制：DoH 比明文 DNS 多一次出口握手，这是不泄漏的选择，不在本变更里改掉。连接期间并行的 `/delay`、以及 TUN / PF / WFP / 系统 DNS 切换只在实机上构成时间，见后续检测。
