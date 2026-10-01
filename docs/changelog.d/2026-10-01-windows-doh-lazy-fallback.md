## 2026-10-01 · Windows (mihomo) 备用 DoH 改为懒查询

- 归属：SHIP_PLAN G1（已连接=能用）；影响 Windows mihomo DNS。macOS sing-box 已是主用成功才停、否则才问备用。
- 来源：main `718eda43`；分支 `cursor/win-dns-lazy-fallback-10e8`；未合 main。
- 缺陷修复：无。
- 新增/优化：`nameserver` 只留 `1.1.1.1` 的出口 DoH。`8.8.8.8` 改到 `fallback`，并打开 `fallback-lazy-query`。代理服务器解析同样只用主用。服务端拒绝明文 fallback，也拒绝把懒查询关掉。
- 工程与测试：`forces_dns_contract` 改为这条合同。`the_service_refuses_a_plaintext_dns_fallback` 拒绝 `8.8.8.8` 和 `fallback-lazy-query: false`。
- 验证：Linux 回环、两个不同 DoH 端口、伪装接受延迟 40 ms、5 次中位数。成功路径时延没有下降，握手从 2 次降到 1 次。主用端口关闭后备用途 129.5 ms、2 次握手仍能答。`cargo test` 未执行：本机 rustc 1.83 不能编译 edition 2024。
- 候选/发布：仅源码，无新候选。
- 剩余限制：needs-hardware。回环上两次握手是并行的，所以时延几乎一样；真机出口可能把两次握手串起来。AI 域名和进程规则未改。
- 2026-10-01 续记：变基到 main `2e9eb35d`（#1140 起 Windows 默认内核是 sing-box）。mihomo 仍是显式选择或 sing-box 镜像缺失时的回退，这份 YAML 的懒查询保留。`live_mihomo_yaml_stays_byte_for_byte_on_its_own_fake_ip_range` 改钉 `884ee2292c509cc84aa43b2ee51c74a3113a8795bc277c6f8021e0f537baf804`。`cargo +1.98.1 test -p tono-core --lib` 的该测试与 `forces_dns_contract` 在改钉后执行。
