| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CONTROLLER-READY-SAMPLING | macOS 控制器就绪的密集采样在累计睡眠 500 ms 后停止，600 ms 才绑定的控制器要到 750 ms 才被发现 | in-PR | [#1386](https://github.com/raydocs/tono/pull/1386) | 低·已确认 | 平均收益取决于绑定时间分布，未实测；总预算、取消和 #1376 的启动失败优先不变；回归未在本机运行 |
