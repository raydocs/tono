| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CONTINUITY-ONLINK-PF | Kill Switch 武装时，不在静态私网表里的在网地址（全球 IPv6 /64、运营商 NAT 或公网 IPv4 网段）仍被 `block drop out` 丢掉；mDNS 规则仍 `keep state (if-bound)` | open | [#700](https://github.com/raydocs/tono/pull/700) 记录，未改 PF | 中·推导 | 故意不改。动态前缀或状态位变更未经 Mac 上 pfctl/实机证明，连接路径在 TUN 之前就武装 PF。需要实机再决定要不要做一条静态放行 |

#688 已去掉 Apple 进程的全目的公网 DIRECT。awdl0、llw0、bridge100、RFC1918、fe80::/10、fc00::/7、ff00::/8 和到 224.0.0.251/ff02::fb 的 5353 仍按原规则放行。本条只记录还没做的部分，避免把路由排除误当成隔空播放已恢复。

2026-10-02 续记（[#1330](https://github.com/raydocs/tono/pull/1330)）：IGMP 和 IPv4 发现组播另记为 MAC-PF-IGMP-OPTIONS 并已修。本条的在网前缀仍不放行：出站放行「网卡当前前缀」等于让本地网络决定哪些公网地址绕过隧道（路由通告可以把任意 /64 说成在网，即 TunnelCrack 的 LocalNet 攻击），见[决策 045](../decisions/045-2026-10-02-macos-lan-discovery-pf.md)。只放行入站发起的在网 IPv6 连接是安全的子集，等实机证明需要再做。
