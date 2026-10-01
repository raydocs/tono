| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-WECHAT-AI-DIRECT | 无住宅跳时，签名微信/钉钉/飞书进程的无地址 TCP 直连规则盖住助手域名，网页里的 AI 从物理网卡出去 | in-PR | #871 | 高·已确认 | 只覆盖带主机名的流和 Anthropic `160.79.104.0/21`；签名进程用 HTTPDNS 直拨该段以外的原始 IP 仍走直连。needs-hardware |

`config.rs` 在没有 `homeProxy` / `homeSocks5` 时不发出 `CLAUDE_HOME_DOMAINS` 与 `CLAUDE_HOME_IPV4_CIDRS`。`tcp_wechat_rules` 与签名路径正则同时存在时，随后的 `DST-PORT` + `PROCESS-PATH-REGEX` 规则把 80/443 上任意目的地交给 `Tono-China-Direct`。住宅跳路径会先把这些域名指到住宅组。回归：`assistant_hosts_precede_address_free_signed_app_direct_without_a_home_hop`、`signed_app_direct_readback_requires_assistant_hosts_on_the_exit`。
