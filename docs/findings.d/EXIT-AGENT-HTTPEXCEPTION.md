| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| EXIT-AGENT-HTTPEXCEPTION | exit-agent 的用量上报、roster ACK、metering ACK 只捕获 `URLError`/`OSError`，边缘返回截断或乱码响应（`http.client.IncompleteRead`/`BadStatusLine`）时跳过轮内重试，整轮以 traceback 结束 | in-PR | perf/control-plane-agent-reliability | 低·已确认（红测） | 状态已先落盘，下一轮可恢复，不丢数据；只影响本轮 |
