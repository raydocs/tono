| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W9 | Windows Service 的 SCM 失败重启动作有缺口：更新执行器与强制停止会先关掉重启动作，并非每条路径都保证把它们装回，而 Service 退出后等 SCM 把它拉起来正依赖这些动作 | open | 待开 | 低·推导（读码，未核实到实机） | 尚无修复 |

来源：2026-09-28 砖机审计推迟项，codex WINDOWS-9 与 opus WIN-7。证据（行号为 `c0e7758e`）：`service/src/bin/install_service.rs:1765,1990`、
`service/src/bin/service.rs:369`、`service/src/bin/shared/mod.rs:103-137`、`service/src/bin/install_service/update_executor.rs:399-400,519,526-529`。
