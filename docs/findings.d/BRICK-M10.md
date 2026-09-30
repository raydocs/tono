| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M10 | macOS `restoreAtLaunch` 每次开机都恢复保护，不看 `kern.safeboot`，也没有非正常开机计数 | open | [#701](https://github.com/raydocs/tono/pull/701) | 低·推导（所有者注：与 fail-closed 冲突） | 不按 `kern.safeboot` 特判（安全模式本来不启动这个 LaunchDaemon）。开机不重新武装在 #701，不在本 PR 再写一份。需实机确认正常开机和安全模式。 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），opus MAC-8，codex 复核；延后记录。
