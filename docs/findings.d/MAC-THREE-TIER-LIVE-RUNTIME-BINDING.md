| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-THREE-TIER-LIVE-RUNTIME-BINDING | 三层模式的特权运行时绑定未排除仍加载旧图的运行中Core，保护许可可能与实际路由图错配 | fixed(6ec54b538) | [#1571](https://github.com/raydocs/tono/pull/1571) | 高·推导 | 已合main；持有Core锁时拒绝运行中Core绑定strict图，显式/sync推断均覆盖；原生生命周期、准确head CI/独立high通过（PR最终回执6233035109）。待实机：安装设备真实PF/运行图行为，非已捕获设备泄漏 |

来源：独立high审查准确head [0c60a578](https://github.com/raydocs/tono/commit/0c60a578b0d3bc76197fd5d134f3617959914eed)。运行时图摘要和持久意图相符不等于运行进程已加载该图；root UID范围限制不替代运行图绑定。本条只记录缺失约束，不公开绕过步骤。新图必须在无live Core时绑定，随后启动仍校验该摘要；显式release后才能更改strict图。
