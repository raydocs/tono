| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| PERF-CONNECT-1 | 省略 client-fingerprint 时 Reality 被 mihomo 拒绝并重试，首连比同核 Clash 慢一个数量级以上 | in-PR | 本 PR | 中·实测 | DoH 仍多一次握手；TUN/PF/WFP/系统 DNS 未在本机测量 |

回环基准（伪装接受延迟 40 ms，mihomo v1.19.30，`--check` 通过）：无指纹的 VLESS 请求失败，伪装握手中位数 12；补上 chrome 后首包 45.1 ms，与直连 DNS 的 Clash 43.3 ms 同级。Hysteria2 首包 2.4 ms 对 3.5 ms。差距留在 DNS：出口 DoH 88.3 ms（VLESS，1 次握手）对明文 0.7 ms。保持 DoH。并行 `/delay` 把同一次首包拉到 71.7 ms、2 次握手。
