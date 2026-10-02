| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PF-LAN-DNS-FRAGMENT | 局域网 DNS 丢弃规则（`tono-lan-dns`，53/853）有三类包管不到：进入 PF 时已分片的 UDP、IPv6 分片头后接扩展头的 TCP、入站建立的状态的回包 | open | 评审 [#1331](https://github.com/raydocs/tono/pull/1331) 时发现，main 上已存在 | 低·源码推导 | 没有修。普通 socket 发不出这些包：IPv4 出站的 PF 钩子在本机分片之前，前两类要 raw socket（root）或转发流量；第三类要局域网主机先从 53/853 端口连进来。把发往局域网的分片全部丢弃可以关掉前两类，但可能丢掉正常的大 UDP 包，没有实机不改 |

依据：xnu `bsd/net/pf.c` `pf_test_fragment`（匹配分片时跳过带端口的规则；TCP 还跳过带标志位的规则）；IPv6 路径遇到分片头后把协议设为分片头的 Next Header 再进入分片匹配，后接扩展头时协议不是 TCP；状态查找先于规则匹配。#1331 把 `tono-lan`、`tono-linklocal` 的出站放行改成 `no state` 时，为 PF 识别为 TCP 的分片加了 `tono-lan-fragment` 丢弃规则，保持改动前的结果；这三类在改动前后相同。
