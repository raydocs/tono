| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-HOT-SWITCH-STAMP | 同代际热切换后，飞行中的延迟和出口 IP 会记到切换后的节点上 | in-PR | #944 Fixes #906 | 中·推导 | 只拒绝错标并在热切换成功后重采样。Windows CI 未在本机跑 |

测量开始时记下 `selected_node`。`record_exit_delay` 与 `commit_exit_identity` 在节点已变时不写入。状态里的出口 IP 只在 `exit_identity_node` 仍等于当前选择时发布。热切换成功后重新做出口身份查询和一次延迟采样。回归：`a_measurement_from_the_previous_exit_is_not_shown_on_the_new_node`。
