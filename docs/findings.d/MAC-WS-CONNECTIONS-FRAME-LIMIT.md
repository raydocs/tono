| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-WS-CONNECTIONS-FRAME-LIMIT | macOS `CoreWebSocket` 用 URLSession 默认的 1 MiB 帧上限，`/connections` 快照超过后接收永久失败、每 2 秒重连一次，连接列表、流量审计和 DIRECT pins 刷新判断都停掉 | fixed(ae4dce5d) | [#1336](https://github.com/raydocs/tono/pull/1336) | 低·推导 | 上限改为 16 MiB，超过仍失败；触发的连接数没有实测 |

依据：`apps/macos/Tono/Core/CoreWebSocket.swift` 的 `createTask` 没有设置 `maximumMessageSize`；`receiveConnections` 的失败分支只标记过期并在 2 秒后重连。2026-10-02 读码发现，主会话核对。
