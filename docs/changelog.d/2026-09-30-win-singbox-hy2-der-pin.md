## 2026-09-30 · Windows sing-box 路径写出 HY2 DER 钉并收紧 fake-IP
- 归属：ops 计划（sing-box 分阶段，不是客户发布门）；影响 `tono-core` 的 sing-box 编译器和 `runtime-template.json`。不改正在使用的 mihomo 连接路径。
- 来源：基线 `d2363002`；分支 `cursor/singbox-hy2-der-pin-01d4`；未合 main。
- 缺陷修复：无（客户仍跑 mihomo）。
- 新增/优化：已准入的 64 位十六进制叶子 DER 指纹写成 sing-box `certificate_sha256`（32 字节的标准 base64）。钉不是 32 字节就整份配置失败，不删字段、不写 `insecure`、不改成 SPKI。未选中的 HY2 同样带钉发出。sing-box 产品模板的 fake-IP 改为 `198.18.16.0/20`，落在 Windows 探测所用的 198.18/16 内、TUN `/30` 外。mihomo 的 `198.18.0.1/16` 不变。
- 工程与测试：更新 HY2 拒绝测试为钉必须出现；新增 fake-IP 区间测试和 mihomo YAML 摘要测试。
- 验证：Linux 上 `cargo test -p tono-core --lib sing_box::runtime`。Windows 实机与 macOS XCTest 未运行。
- 候选/发布：仅源码，无新候选。Service 尚未加载这份 JSON。
- 剩余限制：开关默认关闭。错钉在链路上失败关闭要等实机；本机只证明配置里钉不会被拿掉。macOS Swift 仍用 198.19 和 SPKI，本 PR 不改它。

## 2026-09-30 · 续记：第二条 DoH 和 30 秒 fake-IP TTL
- 归属：同上，仍是 ops 计划里的 sing-box 模板，不是客户发布门。
- 来源：PERF-CONNECT-4。本分支续改，未合 main。
- 缺陷修复：模板只有 `1.1.1.1` 一个 DoH。现在主 DoH 不是 NOERROR 时才问 `8.8.8.8`（SNI `dns.google`），两条都走 `Tono-Exit`，都是 `https`，`alpn` 只有 `h2`。没有 udp、tcp 或 local DNS。`final` 仍是 `Tono-DoH`。`default_domain_resolver` 仍只拨主 DoH，不参加这条回退。
- 新增/优化：fake-IP 的 A 路由写 `rewrite_ttl: 30`。alpha.9 的 fakeip 服务器没有 TTL 字段，默认应答是 600 秒。节点名不能占用 `Tono-DoH-Backup`。
- 工程与测试：`sing_box_dns_falls_back_to_a_second_doh_without_plaintext`。mihomo YAML 摘要测试不改。
- 验证：见本轮 `cargo test -p tono-core --lib sing_box::`。实机未跑。
- 候选/发布：仅源码，无新候选。Service 仍不加载这份 JSON。
- 剩余限制：`rewrite_ttl` 是否被 Windows 解析器按 30 秒缓存，要实机看。NXDOMAIN 会再问备份，多一次握手。生产 h2 是否只有一次握手，本机没有对着 `1.1.1.1` 量过。不把两条 DoH 并行发出。
