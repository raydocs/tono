| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| DESKTOP-ROUTING-CONTRACT-DRIFT | 桌面稳定模式与三层未带上移动端已有的 853、STUN、海外 UDP、HTTPS/SVCB 与 X/Home 辅助规则 | in-PR | #1820 | 高·路由 | AI Home 普通流量仍按 decision 130 不过滤；未做真机泄漏对照 |

稳定模式与三层失败关闭的是整机保护范围。IPv6 STUN 与云 IPv6 TCP 排在整网 IPv6 拒绝之前，否则会被那条拒绝吞掉。
