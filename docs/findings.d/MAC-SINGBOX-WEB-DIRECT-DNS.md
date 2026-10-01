| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-SINGBOX-WEB-DIRECT-DNS | sing-box 产品路径把 web-direct 的 A 查询先答成真 IP，连接上没有域名，域名规则对不上 | in-PR | #817, #958 | 中·推导 | 不打开 reverse_mapping。微信自己的后缀仍走中国 DNS。假 IP 记录只在内存里 |

sing-box `v1.15.0-alpha.3`（`93fff595`）的 DNS 规则按顺序先匹配。`prepareMatchMetadata` 只从 fake-ip 表把域名放回目的地；`reverse_mapping` 默认关，文档写明 macOS 系统缓存 DNS 时这张表不可靠。客户端 A 查询若先命中 hosts 或 `Tono-China-DNS`，随后的 IP 连接匹配不到 web-direct，TCP 落到出口，UDP 被拒绝。拨号仍由 direct 出站的 `domain_resolver` 和 pin 的 `resolve` 动作按指定传输解析，不走这张客户端规则表。
