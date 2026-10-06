| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-CONTROLLER-READY-SAMPLING | macOS 控制器就绪的密集采样在累计睡眠 500 ms 后停止，600 ms 才绑定的控制器要到 750 ms 才被发现 | fixed(e37e11b4) | [#1386](https://github.com/raydocs/tono/pull/1386) | 低·已确认 | 平均收益取决于绑定时间分布，未实测；总预算、取消和 #1376 的启动失败优先不变；回归未在本机运行 |

2026-10-06 合入续记：[#1386](https://github.com/raydocs/tono/pull/1386) 以 `e37e11b4` 合入 main；精确 PR head 的 [ci-gate 37427132996](https://github.com/raydocs/tono/actions/runs/37427132996) 成功，独立 high-risk 覆盖见 PR close-out 评论。`fixed` 仅表示源码合入，不表示实机验收或客户发布。
