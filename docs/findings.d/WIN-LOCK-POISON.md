| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-LOCK-POISON | Windows `lock_unlocked` 用 `ARMED.lock().unwrap()`，违反毒锁恢复不变式，持锁 panic 之后隧道 lock 的 IPC 处理会跟着 panic | in-PR | 待开 | 低·已确认 | 改用 `armed_guard()`；需先有一次持锁 panic；`mark_verified` 同类由 #753 另修 |

`armed_guard` 的注释要求本模块只通过恢复中毒的访问器拿 `ARMED`。`lock_unlocked`（隧道 lock，持有 `WFP_OPERATION`）仍是裸 `unwrap`。中毒后用户无法再次给当前 WinTUN 发许可，直到服务进程重启。看门狗本身用 `armed_guard`，不会被这一处拖死。
