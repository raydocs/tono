| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-WS-ONCONNECTED-WATCHDOG | 本机控制器订阅的连接看门狗会吃掉 onConnected 失败后的重连 | in-PR | [#768](https://github.com/raydocs/tono/pull/768) | 中·已确认 | onConnected 若永远不返回，订阅仍停在已接受的套接字上；不涉及隧道或 WFP |

看门狗在 `connect()` 成功后仍计时。到期会改掉尝试代号。`onConnected` 随后抛错时，catch 因代号不符而不关闭、不重连。
