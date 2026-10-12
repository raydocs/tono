| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CP-PINNED-SILENT-WAIT | macOS 读请求：pinned 地址接受连接后不应答时没有首包预算，要等会话超时，约 60 s 后才轮到中继（文档原写「≤25 s」） | open | [#1523](https://github.com/raydocs/tono/pull/1523)（Sol 终审 minor M2） | 低·推导 | [api-relay.md](../ops/api-relay.md) 已改为只在 pinned 连接失败时成立；代码未改。未在实机复现 |
