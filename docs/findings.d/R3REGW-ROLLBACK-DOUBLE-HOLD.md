| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| R3REGW-ROLLBACK-DOUBLE-HOLD | A second emergency release after update rollback must not remove the AI hold the rollback installed | in-PR | [#1055](https://github.com/raydocs/tono/issues/1055) 一行；#1087 已让同一拦截原地重装；PR 待填 | 低·推导（P2） | 当前 main 上所有执行器紧急放行都是窄的，重复请求不再先删；本 PR 加紧急放行路径的回归（旧代码上本来就是绿的，不是红的）；其余 #1055 行未动 |

回归 `a_second_failed_update_release_keeps_the_hold_the_first_installed`。
