| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-EXIT-PROBE-SLOW-CONFIRM | Windows 已连接时出口静默失效（本机网络没有变化），周期探测第一次失败后要再等一整个 120 秒周期才取第二个样本，期间界面一直是「已连接」而流量不通 | in-PR | [#1343](https://github.com/raydocs/tono/pull/1343) | 中·推导 | 只改第二个样本的时间：失败后下一拍（2 秒）复测；120 秒的探测周期本身未改，出口失效到第一次探测之间最长仍有约 120 秒；第二次失败后仍由原有的就地证明决定是否拆隧道；未实机 |

依据：`apps/windows/app/src-tauri/src/tono/connection/monitor.rs` 的监控循环每 2 秒一拍，周期探测只在距上次探测满 `EXIT_PROBE_INTERVAL`（120 秒）时运行；`connection_health.rs` 的探测腿要连续失败 `HEALTH_FAILURE_THRESHOLD`（2）次才判失效。两条合在一起，第二个样本固定在 120 秒之后：出口失效到判定最长约 120 + 18 + 120 + 18 秒（18 秒是单次证明的超时），之后还要过一次就地证明。这段时间非严格模式的用户既没有隧道也没有被放回原网络。`HEALTH_FAILURE_THRESHOLD` 的注释写的前提是「连续两次失败约等于 4 秒的持续失败」，探测腿不满足这个前提。网络事件上的证明失败（`plan_network_event_probe`）和 macOS 的健康探测（失败后 2 秒一拍）都是下一拍复测。没有实机复现，由读代码推导。
