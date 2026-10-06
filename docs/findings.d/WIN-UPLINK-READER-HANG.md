| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPLINK-READER-HANG | Windows `usable_physical_uplinks` 的原生 spawn_blocking 没有超时，IP Helper 挂起时带 DIRECT 的监控循环会停住 | open | 待开 | 中·实机 | 是否真实挂起需实机（Wi-Fi 驱动重置、睡眠恢复）证明；修法须加超时并复用进程级单飞许可，直到原生调用结束才释放 |

记录于 #1386。
