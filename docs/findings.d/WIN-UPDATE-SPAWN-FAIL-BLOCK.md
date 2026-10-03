| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-UPDATE-SPAWN-FAIL-BLOCK | 更新 Install 在 executor 进程创建失败前就写成 Launching，App 把该状态当成已启动，非严格用户停在 bootstrap 全阻断 | fixed(c8b6aab4) | #961 | 高·推导 | 严格模式仍阻断。image() 在进程已创建但身份未写入时失败，仍要等 Disconnect。needs-hardware。Windows CI 未在本机跑 |

`UpdateRequest::Install` 原先先 `execution(Launching)` 再 `spawn`。spawn 失败时没有进程，WFP 已在 Prepare 里收成 Blocked。App 看到 Launching 就吞掉错误。现在先 spawn；失败且非严格时走 `release_applying_narrow`（普通网络恢复，AI 目的地仍阻断），并且不把 Launching 写盘。回归：`an_executor_that_never_starts_releases_unless_the_kill_switch_is_strict`。
