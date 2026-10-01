| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPD-ADOPT-NONE | 没有记录后继进程时，更新采纳不要求新进程的启动时间晚于发布 | in-PR | [#851](https://github.com/raydocs/tono/issues/851) [#911](https://github.com/raydocs/tono/pull/911) | 低·推导 | 地板是进程启动时钟。字段缺失的旧记录仍可采纳。更旧的执行器重写记录时会丢掉这个可选字段 |
