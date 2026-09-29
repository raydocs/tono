| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M10 | macOS `restoreAtLaunch` 每次开机都恢复保护，不看 `kern.safeboot`，也没有非正常开机计数 | open | 待开 | 低·推导（所有者注：与 fail-closed 冲突） | 未修；所有者注：按开机状态放开保护与 fail-closed 冲突，不按原方向改；brick 审计延后项 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），opus MAC-8，codex 复核；延后记录。
