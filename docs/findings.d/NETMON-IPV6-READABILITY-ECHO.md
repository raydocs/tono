| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| NETMON-IPV6-READABILITY-ECHO | IPv6 读取可用性标志单独翻转被当作拓扑变化，DNS 自写批次会多发网络事件与数据面证明 | in-PR | [#1386](https://github.com/raydocs/tono/pull/1386) | 低·推导 | 拓扑比较只含实际网络字段，外部未读强制发布仍保留；新回归与 hosted CI/窄复审待完成；未实机统计降噪 |

Codex gpt-6.1-sol high 补审 5d8b648f...3e3dcde9 发现 minor；IPv4 不变且 IPv6 默认路由为空时，只翻转 ipv6_unreadable 也可触发 DNS 窗口的发布。
