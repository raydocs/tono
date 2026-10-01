| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-MONITOR-STALE-SNAPSHOT | 健康监视在 DNS/TUN 探测之后仍发布探测前的 Service 快照，界面可显示已过期的 Locked | in-PR | #905 | 中·推导 | 二次读取与写入之间仍有一次锁等待窗口。needs-hardware。Windows CI 未在本机跑 |

`network_monitor_loop` 在 `tono_protected_dns_status` 与最长 18 秒的 TUN 探测之前取样。`snapshot_generation` 在生命周期操作开始和结束时递增。代际变化则丢掉这一拍；代际未变则发布探测之后的快照。回归：`a_kill_switch_sample_is_not_published_after_the_service_generation_moves`。
