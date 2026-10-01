| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| TELEMETRY-FREE-TEXT-IDENTIFIERS | 遥测自由文本（连接错误、时间线 error/reason/probe/from/to）只去凭据，保留出口 IP、UUID、邮箱，服务器原样入库并展平 | in-PR | [#1201](https://github.com/raydocs/tono/issues/1201) | 低·推导（时间线默认关闭） | 服务器端已用 `redactJobResult` 脱敏（不含 IPv6、家目录）；客户端仍发原文：Windows 另开 PR，macOS 无现成脱敏器未改 |
