| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R2UA-F2 | Windows：Install 记 `Launching` 后无人监督更新执行器，它在停 Service 之前退出会让 Core 停着、bootstrap 一直 Blocked | in-PR | #1055；`claude/win-update-executor-watch` | 中·推导 | 待实机；执行器极慢（>120 s）时仍可能在放开后继续安装；决策 120 provisional |
