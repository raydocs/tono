| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R2UA-F2 | Windows：Install 记 `Launching` 后无人监督更新执行器，它在停 Service 之前退出会让 Core 停着、bootstrap 一直 Blocked | in-PR | #1055；`claude/win-update-executor-watch` | 中·推导 | 待实机；执行器极慢（>120 s）时释放先赢、迟到的消费被拒；Status 单次查询上限 5 s；决策 120 provisional |
