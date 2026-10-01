| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-TUN-WAIT-CANCEL | `waitForOwnedTunnelInterface` 最后一次 sleep 之后不看取消，接口在时仍返回 true，连接路径会先武装再发现取消 | open | #864 | 低·推导 | 窗口是最后 100ms。随后的断开仍会放开。函数直接调用 `interfaceExists`，没有测试缝 |
