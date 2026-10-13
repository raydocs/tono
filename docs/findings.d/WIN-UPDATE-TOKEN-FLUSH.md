| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-TOKEN-FLUSH | Windows：执行器用 TerminateProcess 结束 App，绕过失败的轮换 token 退出冲刷 | in-PR | #1055；`claude/win-update-executor-watch` | 低·推导 | 在 Install 之前再冲刷一次；vault 持续不可写时仍不能持久化（只记日志，不阻止更新）；待实机 |
