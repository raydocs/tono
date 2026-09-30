| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CONTINUITY-TUN-EXCLUDE | Darwin auto-route 把有限广播收进 utun，IPv6 组播只在路由规则里 DIRECT、没有从 TUN 路由表排除 | in-PR | 本分支 | 中·推导 | 未在 Mac 上装路由或验证隔空播放。不改 PF。在网全球 IPv6 仍见 MAC-CONTINUITY-ONLINK-PF |

sing-tun 在没有显式 `route_address` 时，给 Darwin 装 `1.0.0.0/8` … `128.0.0.0/1`。`224.0.0.0/4` 已从中挖掉，所以 `240.0.0.0/4` 仍进 utun，其中包括 `255.255.255.255/32`。被收进 TUN 之后再 DIRECT，已经不是链路上的有限广播。`ff00::/8` 出现在 DIRECT 规则里，却不在 `route_exclude_address`。当前 TUN 只有 `198.18.0.1/30`，sing-tun 在没有 IPv6 地址时不装 IPv6 路由，所以这一条今天不改变内核路由；写进排除表是为了两份清单不再分叉。
