| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| AND-UI-09 | 隧道在线且 Activity 已停止时，ConnectedTimer 的 delay 循环仍每秒唤醒主线程 | in-PR | fix/android-scene-energy-20261031 | 低·实测代码 | — |

修复：计时改在 `repeatOnLifecycle(STARTED)` 内每秒走一次，回到前台立即补正。回归：`ConnectedTimerTickTest`。
