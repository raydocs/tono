## 2026-09-30 · 出口 DoH 预热、复用与 fake-ip 离开首包

- 归属：SHIP_PLAN 客户连接路径（源码）。叠在拨号默认值分支上。不是 G4 发布。不改 TUN / PF / WFP / 路由。不合入。
- 来源：拨号默认值分支 `ac057039` → 本分支；未合 main。
- 缺陷修复：无单独的客户故障单。冷 DoH 仍比明文 UDP 多一次出口握手；本变更不把解析改成明文。
- 新增/优化：拥有的运行时写 `fake-ip-ttl: 30`、`prefer-h3: false`、`cache-algorithm: lru`。两个 DoH 服务器都留着。fake-ip 仍在首包之前本地回答，真实解析走出口 HTTP/2 连接池（空闲 5 分钟，mihomo 自带）。预热失败不撤销已经发出的请求。30 秒是断线后系统缓存没刷掉时的恢复上限。
- 工程与测试：回环基准先量 fake-ip 与首包，再量冷 DoH、同名缓存、下一次不同名字的连接复用。`--check` 增加这些上限。
- 验证：本机 `python3 tooling/perf/connect-bench/bench.py --check` 退出码 0（2026-09-30，5 次中位数，伪装 40 ms）。VLESS 修正形状：fake-ip 0.2 ms、0 次握手；首包 45.7 ms、1 次握手（DoH 不在这条路径上）；冷 DoH 87.4 ms、1 次握手；同名缓存 0.6 ms、0 次握手；下一个名字 44.2 ms、0 次新握手。Clash 明文 DNS 1.1 ms，缓存 0.4 ms。Hysteria2 冷 DoH 46.3 ms，缓存 0.5 ms，复用 43.6 ms。无指纹的 VLESS 仍然失败。`cargo test` 与 XCTest 未跑：本机 rustc 1.83 不能编 edition 2024，且没有 Xcode。
- 候选/发布：仅源码，无新候选。
- 剩余限制：冷的第一次真实解析仍要付一次出口握手。控制器就绪时的预取在已合入的 #736（不阻塞连接）。TUN / PF / WFP / 系统 DNS 仍只在实机上构成时间。
- 2026-09-30 续记：rebase 到 main `939177f4` 之后，`live_mihomo_yaml_stays_byte_for_byte_on_its_own_fake_ip_range` 仍钉着旧 YAML 摘要。摘要改为这次运行时的 `82c6545e00c8e42058d1a3d6b93d43218c563cc25c5755bc82b663d41630c501`。本机没有重跑 `cargo test`。
