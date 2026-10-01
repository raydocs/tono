| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-SUSPENDED-SUCCESSOR | Windows 更新执行器持久化挂起后继 App 后、恢复主线程前突然退出，恢复把该 App 的存活当作可向前恢复而直接返回，App 永不运行，保留的更新 WFP 阻断可能持续切断普通网络 | in-PR | 待开 | 高·推导 | 已改为身份完全匹配后先唤醒再返回，唤醒与枚举失败不能算恢复成功；一条 Rust 回归未运行，需 hosted Windows CI；网络恢复需实机，needs-hardware。原执行器在 Service 启动检查之后才崩溃时仍可能等下一次启动才触发恢复；创建到身份持久化之前的崩溃窗口未修 |

来源：main `ff81118a` 读码确认；分支 `codex2/win-update-suspended-successor`。执行器以 `CREATE_SUSPENDED` 启动后继、保存 PID/创建时间/摘要与 `Execution::Replaced` 后等待 Service 就绪（最长约 20 s），突然退出不运行 Rust 析构；旧恢复分支只验证 `native::image(e.pid) == e` 就返回。触发概率按本轮评估为 P3，后果为非严格模式普通网络持续被阻断。

修复：仅在原执行器不再存活时处理已记录且身份完全匹配的后继；持有进程句柄后再次验证完整身份，Toolhelp 枚举线程并在打开句柄后复核所属 PID，每线程一次 `ResumeThread`，接受已运行的计数 0，不循环耗尽其他挂起计数。后继继续现有 Adopt/恢复/标准释放路径，不新增 AI 层，不改严格杀开关。单元回归只覆盖恢复决策与调用顺序，不能证明真实 Windows 线程或 WFP 恢复已通过。

2026-09-30 续记：同分支保留本修复，并加入相邻的 [WIN-UPDATE-RESTART-FAIL-OPEN](WIN-UPDATE-RESTART-FAIL-OPEN.md)：Service 重启或 IPC 就绪失败时，非严格会话由独立执行器调用标准应急释放；两项组成同一 Windows 更新执行器失败恢复 PR，均未运行 Windows 回归或实机。
