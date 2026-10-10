| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M10 | macOS `restoreAtLaunch` 每次开机都恢复保护，不看 `kern.safeboot`，也没有非正常开机计数 | fixed(52136e58) | [#701](https://github.com/raydocs/tono/pull/701)，[#710](https://github.com/raydocs/tono/pull/710) | 低·推导（所有者注：与 fail-closed 冲突） | 不按 `kern.safeboot` 特判（决策 034：该 LaunchDaemon 不在安全模式运行）。#701 与 #710 都把 `restoreAtLaunch` 留空；#710 在 Core 不在时立刻放行并恢复 DNS。合并顺序 #701 → #708 → #710，留一次放行。2026-10-10 A15 核对：#701（`847e1e02`）、#710（`52136e58`）均已合 main，`KillSwitchManager.restoreAtLaunch()` 开机不再重装屏障。待实机。 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），opus MAC-8，codex 复核；延后记录。
