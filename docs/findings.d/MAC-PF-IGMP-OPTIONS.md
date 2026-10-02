| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PF-IGMP-OPTIONS | Kill Switch 武装时 IGMP（带 Router Alert 选项）进出都被 PF 丢弃，IPv4 组播出站只放行 mDNS；IGMP snooping 网络上 Mac 收不到组播发现，SSDP/广播发现发不出去 | fixed(c1c4651d) | [#1330](https://github.com/raydocs/tono/pull/1330) | 中·推导 | 源码和 `man pf.conf` 证实了丢包规则，没有实机证明这就是通用剪贴板/投屏失效的原因；需要实机 |

依据：`man pf.conf` 的 `allow-opts`（「IPv4 packets with IP options … are blocked … The implicit pass rule … does not allow IP options」）；xnu `bsd/net/pf.c` 在 `action == PF_PASS && h->ip_hl > 5` 且规则和状态都没有 `allow_opts` 时改判 `PF_DROP`（`PFRES_IPOPTIONS`）。IPv6 一侧只计路由扩展头，MLD 不受影响，所以 Apple 设备之间的 mDNS 仍可能经 IPv6 工作，这也是本条定为「推导」的原因。
