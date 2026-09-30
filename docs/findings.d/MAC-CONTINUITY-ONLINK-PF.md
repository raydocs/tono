| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CONTINUITY-ONLINK-PF | Kill Switch 武装时，不在静态私网表里的在网地址（全球 IPv6 /64、运营商 NAT 或公网 IPv4 网段）仍被 `block drop out` 丢掉；mDNS 规则仍 `keep state (if-bound)` | open | 本分支记录，未改 PF | 中·推导 | 故意不改。动态前缀或状态位变更未经 Mac 上 pfctl/实机证明，连接路径在 TUN 之前就武装 PF。需要实机再决定要不要做一条静态放行 |

#688 已去掉 Apple 进程的全目的公网 DIRECT。awdl0、llw0、bridge100、RFC1918、fe80::/10、fc00::/7、ff00::/8 和到 224.0.0.251/ff02::fb 的 5353 仍按原规则放行。本条只记录还没做的部分，避免把路由排除误当成隔空播放已恢复。
