## 2026-11-03 · 桌面防泄漏对齐、四节点实况钉住、Android 503 自恢复、client_platform

- 归属：SHIP_PLAN G1（已连接=能用；稳定模式与三层的整机保护范围失败关闭，海外 UDP/STUN/DoT 不得从物理出口泄漏）。AI Home 普通流量仍按 decision 130 不过滤。影响 macOS / Windows 路由合同、Android VPN、控制面目录与鉴权。
- 来源：`main` `372a4cc6c` → `cursor/desktop-routing-android-platform-ad16`（#1820）；未合 main。
- 缺陷修复：桌面稳定模式与三层原先没有移动端合同里的 853、STUN（含 IPv6）、海外 UDP、DNS HTTPS/SVCB、Home 辅助域名和 X 后缀（`grok.x.com` 仍走 Home）。Android 首次目录 503 会失败并清掉连接意图，进程异常退出没有通知，底层网络丢失时 `setUnderlyingNetworks(null)` 会回到系统默认。现 503 按 1s/2s/4s 退避重试且保留意图；异常退出发 `CORE_STOPPED`；无网络时传入空网络列表。
- 新增/优化：控制面接受可选 `client_platform`（正文或查询）。合法值为 macos/windows/android/ios；写请求上显式非法值返回 400，目录查询上的非法值忽略。缺省字段保持旧客户端行为。`X-Tono-Client` 仍优先。只带平台时不改写已有 `client_version`。android/ios 即使带 `X-Tono-Accept: hy2` 也去掉 hy2 块。四台已上线出口的 Reality SNI 与 TCP 配置记在 `config/fleet/live-node-pins.json`。
- 工程与测试：路由名单仍由 `sync-routing-domains.mjs` 从 `direct_domains.rs` 生成 macOS 图。不改签名、发布、PF/WFP，不引入 `skip-cert-verify`，不含密钥。
- 验证：`node --test tooling/scripts/tests/routing-domains-sync.test.mjs` 通过；`node tooling/scripts/sync-routing-domains.mjs --check` 通过；`node --test tooling/scripts/tests/live-node-pins.test.mjs` 通过；控制面 `vitest` 上述三个测试文件 54 项通过。`python3 apps/ios/tools/sync-desktop-routing.py --check` 与 `python3 apps/android/scripts/routing/sync-desktop-routing.py --desktop . --check` 通过（模板字节变了，合同摘要随之重写）。未跑 `cargo test`（rustc 1.83，工作区要 Rust 1.98 / edition 2024）、Android Gradle、XCTest、实机。
- 候选/发布：仅源码，无新候选、签名包、生产部署或客户发布。
- 剩余限制：未 SSH、未改四台 VPS 的 sysctl 或 Xray，未部署 Worker，未重发目录。钉住文件只防止仓库再部署时漂移；线上值本身没有在本次被重新测量。
