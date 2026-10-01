| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-MARK-VERIFIED-POISON | Windows `mark_verified` 用 `ARMED.lock().unwrap()`，违反毒锁恢复不变式，任何 panic 后该 IPC 处理会跟着 panic | in-PR | 分支 `codex/win-startup-release-retry` | 低·已确认 | 改用 `armed_guard()`，有单测 |

来源：GLM-5.3 bug hunt #11。
