| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-WAKE-GATE-RACE | macOS didWake 可能先于 Helper 的 HasPoweredOn 开门，arm 在门关闭期间被拒为电源过渡 | open | 待开 | 中·实机 | 事件先后需同机单调时间实验；证实后只对编码的 power-transition 拒绝做短、有界、可取消的重试，不提前开门、不绕过 PF |

Codex 核验 NEEDS-HARDWARE。MAC3-RECHECK-F2（fixed 3c3f9b95）是 reassert 返回后的取消检查，不覆盖此竞争。记录于 #1386。
