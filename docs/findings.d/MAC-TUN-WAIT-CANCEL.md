| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-TUN-WAIT-CANCEL | `waitForOwnedTunnelInterface` 最后一次 sleep 被取消后仍按接口是否存在返回，连接路径会先武装 | in-PR | #864 | 低·推导 | 窗口是最后一次间隔。随后的断开仍会放开 |

`try?` 会吞掉 `CancellationError`。循环结束后先看 `Task.isCancelled`，再读接口。
