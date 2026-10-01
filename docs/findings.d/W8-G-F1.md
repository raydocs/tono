| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| W8-G-F1 | Windows owned runtime 校验不要求流量留在 TUN 上：`udp` 与 `tun.auto-route` 可关，`route-exclude-address` 可不限于本文档 VLESS/Hysteria2 出口的 IPv4/32 | in-PR | [#917](https://github.com/raydocs/tono/pull/917) | 高·推导 | 规则正文仍不重推（WFP 端点约束仍在，H2-F3 剩余限制）；未实机。拒绝发生在 arm 之前，合法 App 输出仍是 `/32` 出口地址 |

Service 按 SYSTEM 启动调用方交出的 Mihomo YAML。生成器把 `udp: true`、`tun.auto-route: true` 和「所选/住宅节点 IPv4/32」写成捕获不变量；校验原先只要求 `strict-route: true`，排除列表只核对键名。排除过宽或关闭自动路由时，用户流量不进 TUN，已武装的 WFP 会丢掉这些包，界面仍可显示已连接。
