| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-W8 | Windows 上 App 或 Core 文件缺失时保护仍保持：屏障照样恢复，却没有能连上的 App 或 Core | open | 待开 | 中·推导（读码，未核实到实机） | 尚无修复；仍 fail-closed，释放走「恢复网络」快捷方式 |

来源：2026-09-28 砖机审计推迟项，codex WINDOWS-8。证据（行号为 `c0e7758e`）：`service/src/core/windows_kill_switch.rs:571,2492`、
`service/src/core/desired.rs:248`。
