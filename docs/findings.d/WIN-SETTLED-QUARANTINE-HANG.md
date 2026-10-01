| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-SETTLED-QUARANTINE-HANG | 提权助手超时后运行状态查询一直等一个不会来的完成通知 | in-PR | 待开 | 中·推导 | 隔离槽仍占着，第二次安装助手要重启进程才肯再跑 |

超时把 `privileged_outcome_uncertain` 留下，`OperationGuard` 的 Drop 不叫醒 `settled`，`operation_running` 也不清。`get_runtime_state` 以及任何已经停在 `settled` 里的读取会等到进程退出。槽本身继续拒绝第二个安装助手。
