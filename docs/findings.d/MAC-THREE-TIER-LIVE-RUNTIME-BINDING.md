| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-THREE-TIER-LIVE-RUNTIME-BINDING | 三层模式的特权运行时绑定未排除仍加载旧图的运行中Core，保护许可可能与实际路由图错配 | in-PR | [#1571](https://github.com/raydocs/tono/pull/1571) | 高·推导 | 本PR续修在持有Core锁时拒绝对运行中Core绑定strict图，覆盖显式模式及sync推断模式；既有原生生命周期回归扩展。准确head CI/独立复核待完成，非已捕获设备泄漏，未合main或进入客户候选 |

来源：独立high审查准确head [0c60a578](https://github.com/raydocs/tono/commit/0c60a578b0d3bc76197fd5d134f3617959914eed)。运行时图摘要和持久意图相符不等于运行进程已加载该图；root UID范围限制不替代运行图绑定。本条只记录缺失约束，不公开绕过步骤。新图必须在无live Core时绑定，随后启动仍校验该摘要；显式release后才能更改strict图。
