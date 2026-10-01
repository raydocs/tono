## 2026-09-30 · IPv4 未启用时 DNS 兼容脚本仍配置 IPv6
- 归属：SHIP_PLAN §2 item 10（解析器不留在隧道上）；Windows Service DNS live apply。Issue #849。
- 来源：基线 `50bbbbf0` → 分支 `cursor/win-dns-ipv4-skip-ipv6-f0e7`（本分支 PR），未合 main。
- 缺陷修复：`Set-AdapterDns` 在 IPv4 `SetDNSServerSearchOrder` 返回 84（IP not enabled）时把整个适配器记入 skips 并 `return`，IPv6 的 `netsh` 不会跑，失败列表里也没有它，所以不会重试。适配器可以有 IPv4 索引（于是进了 IPv4 分支）同时 IPv6 仍活着。现在 84 只把这一族的期望列表当成没有参与（`$v4 = $null`），然后继续 IPv6。其他非 0 返回值仍把适配器记为失败并返回。两族都没写到时，末尾仍按 skip 处理。
- 新增/优化：无。
- 工程与测试：`ipv4_not_enabled_does_not_skip_the_ipv6_block`。
- 验证：本机 `rustc 1.83.0` 编不过 `edition = "2024"`，未安装更新的工具链，`cargo test` 未跑。由托管 `windows-2025` CI 执行。
- 候选/发布：仅源码，无新候选。
- 剩余限制：CIM 对象取不到（`$c` 为空）时仍把整个适配器记为失败并返回，IPv6 同样不会跑。84 的实机组合（IPv4 未启用、IPv6 有索引）未在本环境复现。
