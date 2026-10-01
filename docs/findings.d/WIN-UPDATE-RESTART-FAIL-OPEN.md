| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-RESTART-FAIL-OPEN | Windows 更新后的 Service 启动失败或 IPC 就绪超时，执行器只返回重启错误，后续恢复认可目标摘要却不恢复 Service，App 无法通过 IPC 释放保留的更新 WFP，非严格用户网络持续被切断 | in-PR | #858 | 高·推导 | 两条重启错误出口已统一先尝试非严格标准应急释放，严格会话保持阻断；一条新增 Rust 回归未运行，需 hosted Windows CI；Service/DNS/WFP/严格模式仍需实机，needs-hardware。停服、门锁或释放失败仅记日志，仍返回原重启错误；标准墓碑写入失败仍可阻止 WFP 删除 |

来源：main `ff81118a` 读码确认；分支 `codex2/win-update-suspended-successor`。目标全部发布并验证后，`service.start` 或 `wait_for_service_ready` 失败，成功发布与失败回滚后的 `restart?` 都没有释放。恢复对完整目标直接返回，不能提供 App 所需的 Adopt/Connect/Disconnect IPC。触发概率按本轮评估为 P2，后果为非严格模式普通网络持续阻断。

修复：同一 `execute` 在两个返回出口前统一处理失败；用既有 `IntentRecord` 只读确认 `wanted` 与显式严格标志。非严格时持修复门、暂停 SCM 恢复、停下不可用 Service，取得 owner 并复核严格标志，再调用已公开的 `emergency_disarm_windows_kill_switch` 标准 DNS/WFP/NRPT 释放；沿用可放弃阻塞工作的 runtime，避免清理超时变成析构挂起。不论暂停 SCM 恢复、停服或释放的结果如何都尝试恢复 SCM 恢复策略，不主动重启 Service。释放失败只记录，不覆盖原重启错误。更新计划、备份、标记与证据保留，不新增 AI 阻断层。与 [WIN-UPDATE-SUSPENDED-SUCCESSOR](WIN-UPDATE-SUSPENDED-SUCCESSOR.md) 同一 themed PR，前一修复保留。
