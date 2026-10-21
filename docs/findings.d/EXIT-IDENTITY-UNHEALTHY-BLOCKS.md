| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-IDENTITY-UNHEALTHY-BLOCKS | 已发布目录里只要有一个出口没有确认这台设备的身份，目录就一直 503，退出再登录也不会换身份 | fixed(c39a9c17d) | #1674 | 中·已确认 | 已合 main，进 0.0.78 RC；待实机。生产尚未部署；运维仍须对未确认的出口做身份同步，或在它无法确认时下架。本代理不读、不写生产 |

`GET /api/v1/exit-catalog` 在 `selectAcknowledgedExitIdentity` 之前要求每个被追踪的出口 `status = active` 且 `last_roster_at` 大于 `device_exit_credentials.created_at`。名册是出口来拉的：`tono-exit-agent` 只有整轮对账成功才 `POST /api/v1/home/roster-ack`。一个停更、禁用、没有 `exit_nodes` 行，或对账失败因此不确认的已发布名字，会让这条门永远关着。`POST /api/v1/auth/logout` 只撤销该设备的会话，不改 `device_exit_credentials.created_at`，所以退出再登录仍是 `EXIT_IDENTITY_PROPAGATING`。

修复：15 分钟内仍在确认、但还没越过这张凭据的出口算作待确认，单独存在时继续 503；禁用、缺失、从未确认或确认早于 15 分钟的出口不再挡住已经确认的兄弟，响应里只留下已确认的出口。不铸造新的设备 UUID。Windows 连续停在这个 503 满 5 分钟后停止 15 秒短重试，并给出「重新准备出口身份」（只再拉一次目录）。
