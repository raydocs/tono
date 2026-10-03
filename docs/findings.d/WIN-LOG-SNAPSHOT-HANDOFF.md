| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-LOG-SNAPSHOT-HANDOFF | 打开核心日志时一次 NotActive 就会在 StartClash 窗口里跑所有者恢复 | fixed(961f8b1e) | #929 | 中·推导 | 仍持有会话时的 NotActive 照旧恢复 |

`get_clash_log_snapshot_by_service` 见到 `NotActive` 就 `recover_after_owner_loss`。StartClash 在回复前会清掉本地会话，这段窗口可以长达整次启动。恢复会 `core_stopped` 并清掉随后 adopt 写上的会话。所有者监视器对同一种回复要连续三次才动手。诊断采集路径已经故意不走恢复。
