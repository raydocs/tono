| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| API-RELAY-SAME-PROVIDER | 两台 API 中继（179.253.233.220、179.255.154.17，均 :2053）同属 AS906 DMIT Cloud Services、同在洛杉矶（ipinfo 2026-10-10，主机名均 `host-by.dmit.com`）：同一商家 / ASN / 城市，DMIT 网络或机房故障、DMIT 到国内运营商的路由变化、或对 DMIT 地址段的封锁会让两台同时失效，中继回退整体消失（客户端回到无中继时的行为） | in-PR | [#1525](https://github.com/raydocs/tono/pull/1525)（记录）；[#1538](https://github.com/raydocs/tono/pull/1538)（第三台中继） | 中·推导 | #1538 合入后商家维度缓解：第三台 154.84.56.196:2053（AROSSCLOUD AS400619，非 DMIT）已部署（2026-10-10，节点侧），客户端/控制面列表在 #1538。**仍同在洛杉矶**（与 DMIT 约 1 ms），洛杉矶区域或共同上游的事故仍可能三台同时失效；「不同地区」未满足。国内家宽未实测 |

依据：2026-10-10 从 agent orb 查询 `https://ipinfo.io/<ip>/json`，两台都返回 `"org": "AS906 DMIT Cloud Services"`、
`"city": "Los Angeles"`、`"postal": "90017"`。决定 077 选 DMIT 是因为它对国内三网优化，新增的中继需要同样在三网
可达，选址前用 [cn-acceptance.md](../ops/cn-acceptance.md) 的 3c / 4.x 或 `tcp.ping.pe` 先测。

2026-10-10 续记：38.14.195.144（Uscloud，圣何塞）入站 2053 被商家挡住，从未可用，由 154.84.56.196 取代（所有者经 Puck 批准仅部署 2053 SNI 透传中继）。外部验收见 [api-relay.md](../ops/api-relay.md)「Los Angeles · Arosscloud」与 #1538。
