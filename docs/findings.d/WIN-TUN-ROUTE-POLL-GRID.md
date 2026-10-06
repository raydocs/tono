| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-TUN-ROUTE-POLL-GRID | Windows 锁定后等受保护路由就绪的轮询间隔为 100 ms，路由已就绪时平均多等约 50 ms | in-PR | [#1418](https://github.com/raydocs/tono/pull/1418) | 低·推导 | 间隔改为 20 ms，20 秒上限不变；只是常量，没有单独回归；收益未实测 |

来源：2026-10-04 连接速度审查 S6。见 [changelog](../changelog.d/2026-10-06-windows-connect-speed.md)。
