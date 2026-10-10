| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| API-RELAY-SAME-PROVIDER | 两台 API 中继（179.253.233.220、179.255.154.17，均 :2053）同属 AS906 DMIT Cloud Services、同在洛杉矶（ipinfo 2026-10-10，主机名均 `host-by.dmit.com`）：同一商家 / ASN / 城市，DMIT 网络或机房故障、DMIT 到国内运营商的路由变化、或对 DMIT 地址段的封锁会让两台同时失效，中继回退整体消失（客户端回到无中继时的行为） | open | 本条目所在 PR（`amp/cn-acceptance`） | 中·推导 | 所有者动作：在**不同商家、不同地区**（不同 ASN，最好不在洛杉矶）加一台中继，并按 [api-relay.md](../ops/api-relay.md) 同步四处列表（Windows `bootstrap.rs`、macOS `ControlPlanePath.swift`、控制面 `api-relays.ts`、文档）。本条目未购买、未部署任何东西；客户端 `bootstrap.rs` 注释「两台不同主机，一台下线不带走回退」只覆盖单机故障 |

依据：2026-10-10 从 agent orb 查询 `https://ipinfo.io/<ip>/json`，两台都返回 `"org": "AS906 DMIT Cloud Services"`、
`"city": "Los Angeles"`、`"postal": "90017"`。决定 077 选 DMIT 是因为它对国内三网优化，新增的中继需要同样在三网
可达，选址前用 [cn-acceptance.md](../ops/cn-acceptance.md) 的 3c / 4.x 或 `tcp.ping.pe` 先测。
