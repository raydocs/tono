## 2026-09-30 · 连接基准加上 sing-box 1.15.0-alpha.9

- 归属：SHIP_PLAN 客户连接路径（源码）。叠在出口 DoH 复用分支上。不是 G4 发布。不改 TUN / PF / WFP / 路由。不合入。不改 #727–#730 的文件。
- 来源：DoH 复用分支 → 本分支；未合 main。
- 缺陷修复：无。发出器上的缺口记在 PERF-CONNECT-4，不在别人的 PR 里改。
- 新增/优化：无产品行为变化。
- 工程与测试：回环基准增加第三个客户端，stock sing-box 1.15.0-alpha.9（tarball SHA-256 `8aede1f5935a856d939c61413677dc2e7e3eb0046efbc22b9a869229e6da279f`，revision `132b38e9`，与认证针同一提交，不是 Tono 签名包）。VLESS 显式 chrome uTLS，DoH 走 `https` 不走 HTTP/3，首包前不发探测。证书用本地叶子路径校验，不写 insecure。
- 验证：本机 `python3 tooling/perf/connect-bench/bench.py --check` 退出码 0（2026-09-30，5 次中位数，伪装 40 ms）。sing-box VLESS：启动 42.0 ms，fake-ip 0.5 ms / 0 次握手，首包 42.8 ms / 1 次握手，冷 DoH 129.5 ms / 2 次握手，同名缓存 0.6 ms / 0 次，下一个名字 43.3 ms / 0 次新握手。Hysteria2 首包 3.9 ms，冷 DoH 46.3 ms，缓存 0.4 ms，复用 43.4 ms。`cargo test` 与 XCTest 未跑。
- 候选/发布：仅源码，无新候选。
- 剩余限制：见 PERF-CONNECT-4。main 上的 Windows 模板已经有 `rewrite_ttl: 30` 和 `Tono-DoH-Backup`。仍开放的是冷 DoH 多一次握手，以及 macOS 发出器的指纹和 fake-ip 段。
