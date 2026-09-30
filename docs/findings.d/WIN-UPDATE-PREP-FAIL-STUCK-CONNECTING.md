| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-PREP-FAIL-STUCK-CONNECTING | Windows Prepare 与状态快照读取同时失败时跳过已取消连接的收敛，FSM 停在 Connecting，Connect 被拒且 Retry 无动作 | in-PR | 待开 | 中·推导 | 仅源码；未运行 Windows 回归或 Service 暂不可达实机注入；无 Core 存活证据时不折叠 Connected |

状态快照现在作为 `Option<bool>` 传给原收敛函数，读取失败也调用它。仅本次更新取消且代际未变的 Connecting 收敛：未武装回到 Not Connected，已武装保留标记进入 Protected Offline；后继连接不动。`Attempt::Stale` 继续由取消方完成 FSM 清理。回归：`failed_prepare_with_unreadable_snapshot_still_folds_connecting`。
