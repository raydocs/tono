| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| PERF-CONNECT-3 | 出口 DoH 的第一次真实解析比明文 UDP 慢，但 fake-ip 已把 DNS 移出首包 | in-PR | 本 PR | 中·实测 | 冷 DoH 仍是一次握手；预取在另一条 PR；系统 DNS 未在本机测量 |

回环上（伪装 40 ms）旧顺序把 `/dns/query` 放在首包前面：VLESS DoH 88.3 ms / 1 次握手，Hysteria2 46.6 ms，Clash 明文 0.7 ms。改完后 VLESS（`--check` 通过的那一轮）：fake-ip 0.2 ms / 0 次握手，首包 45.7 ms / 1 次握手，冷 DoH 87.4 ms / 1 次握手，同名缓存 0.6 ms / 0 次，下一个名字 44.2 ms / 0 次新握手。缓存和 fake-ip 对齐明文 DNS。新名字复用 HTTP/2 客户端，不再付第二次 Reality；剩下的约 44 ms 是这一跳的隧道往返（伪装延迟把这条连接的 RTT 抬高了）。`prefer-h3` 保持关闭，避免 QUIC 探测抢第一次 TLS。
