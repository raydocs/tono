| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HELPER-HANG-WATCHDOG | helper 卡在不可中断睡眠时，进程内空闲循环和 launchd KeepAlive 都不会放行网络 | open | 待开 | 中·推导 | 未实现第二个 LaunchDaemon。KeepAlive 不重启 D 状态进程，ExitTimeOut 的 SIGKILL 也杀不掉。用 socket 超时判断会误伤：helper 一次只处理一个连接，arm 的解析可以堵很久。helper 卡在 pfctl 时，第二个 pfctl 也会堵在同一把锁上，没有实机不能证明带超时的冲刷能成功。安装第二个 root daemon 的装/卸必须幂等，做错会留下无人看管的特权任务。 |

2026-09-30：评估后不落地。需要实机再决定能不能做只在 D 状态持续出现时冲刷 `tono.killswitch` 的外部看门狗。
