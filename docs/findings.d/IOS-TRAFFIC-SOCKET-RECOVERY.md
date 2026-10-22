| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| IOS-TRAFFIC-SOCKET-RECOVERY | iOS 统计 socket 连接失败或断开后只清空客户端，隧道健康且没有新 NE 通知时不能恢复，旧回调也未按统计会话隔离 | in-PR | `t3/ios-traffic-monitor-retry`（本 PR） | 低·已确认（云端确定性回归） | 旧行为经仅依赖抽取的 `320bc9e84` 在 Devin macOS 编译成功后真实断言失败；不是未经改动的基线测试。修复的 GREEN、原生构建和准确 SHA 见本 PR 验证评论；shim 测试不证明真实 Libbox/NE 行为，签名真机统计 socket 故障、登出、重连仍待验。 |

调用链：`TunnelController` 的 NE 通知/`load` → `AppModel.tunnelChanged(.connected)` →
`TrafficMonitor.start`。前台 `load` 可能偶然再次触发 start；`readStatus` 的定时重确认与退出探测
不启动统计，也没有外层统计重试。原 `start` 的 catch 和 `disconnected` 只清空 client。
`traffic.onRate` 仅赋值 `rx/tx`，不是连接/保护状态的证据；修复保留这个边界。

重试为 1、2、4、8、16、30 秒封顶，之后每 30 秒继续，只有收到新统计才复位。
停止/登出同步作废统计会话，取消定时器；连接返回、回调接收、主线程交付分别核对会话/实例/样本。
新 NE connected date 替换旧统计会话；非 connected 状态及显式断开立即停止统计。
同步的 native `connect()` 不能被 Swift 侧抢占：停止期间其返回后立即丢弃并断开，不能发布速率或安排重试。
静默挂起且不报告断开的 socket 超时检测不在本项范围。
