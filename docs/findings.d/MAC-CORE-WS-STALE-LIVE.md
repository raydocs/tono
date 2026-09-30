| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CORE-WS-STALE-LIVE | macOS Core WebSocket 接收失败未标记停滞，持续重连失败时旧流量速率与连接快照仍显示为实时 | in-PR | 待开 | 低·推导 | 接收失败先标记停滞，成功接收沿用既有恢复；无现成 XCTest 故障注入点，Swift/XCTest 未执行，待托管 macOS CI |

来源：main `846705c7`；分支 `codex2/mac-websocket-stall`；未合 main。

复核：`CoreWebSocket.receiveTraffic` 与 `receiveConnections` 原失败分支直接清空 socket 并重连；`checkStreamLiveness` 只检查非空 socket，`startTrafficStream` 与 `startConnectionsStream` 每次重置时间戳。调用方 `AppState` 的 `onStreamStalled` 清除对应实时标记，`onStreamRecovered` 与数据回调恢复标记；本次只补失败分支的停滞通知。
