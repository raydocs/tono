| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPD-RETIRE-SCHTASKS | 非 C: 系统盘上，已提交的原生更新和最终卸载用写死的 `C:\Windows\System32\schtasks.exe` 退休 `Tono Update Recovery v1`，删除失败被记日志后仍返回成功，SYSTEM ONSTART 任务一直留着 | in-PR | [#824](https://github.com/raydocs/tono/pull/824) | 低·已确认 | 本机无法跑 Windows-only `update.rs` 测试；任务删除本身未实机 |

X3-2（#471）只改了注册路径 `recovery_task_registration`。退休函数 `retire_recovery_task` 仍写死 `C:\Windows\System32\schtasks.exe`（`core/update.rs`）。`finish_committed` 在退休失败时只打日志并返回 `Ok`。`GetSystemDirectoryW` 指向其他卷时，提交后的开机恢复和最终卸载都删不掉该任务。
