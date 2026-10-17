| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| DESKTOP-RECOVERY-ROUTING-MODE | 双端自动恢复重新读取“下次显式连接”设置，可能在没有显式重连时改变当前会话路由 | fixed(6ec54b538) | [#1571](https://github.com/raydocs/tono/pull/1571) | 高·推导 | 已合main；准入捕获模式、自动恢复保留捕获值、显式结束才消费新设置；双向恢复/拒绝准入回归及准确head CI/独立high通过（PR最终回执6233035109）。待实机：真实失败恢复及显式重连，不把源码fixed称设备验收 |

来源：独立high审查准确head [6791167fc](https://github.com/raydocs/tono/commit/6791167fc7ee10c45b7ba18e997eb7fd5cd3f742)。设置仍只保存下一次意图，不热切换、不解除保护；持有strict的重启恢复不会因偏好改回stable而释放floor。本项不改变其他恢复Issue的状态。
