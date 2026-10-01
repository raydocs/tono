| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M8 | macOS 原生更新回滚持续失败时 helper 一直停着、PF 保持，没有可用的恢复通道（`UpdateExecutor.swift:194-210`） | in-PR | [#708](https://github.com/raydocs/tono/pull/708) | 中·已确认 | 回滚失败时先释放 PF 并尽量恢复 DNS，不把回滚记成成功，不删账本。helper 仍可能停着，等下次开机由 LaunchDaemon 拉起；那时若状态文件已删就不会重新武装。未实机 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），opus MAC-6，codex 复核；延后记录。
