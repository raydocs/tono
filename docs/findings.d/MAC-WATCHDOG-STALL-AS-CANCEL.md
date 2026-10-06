| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-WATCHDOG-STALL-AS-CANCEL | macOS 连接看门狗超时取消尝试时记为 connectCancel，而不是失败 | open | 待开 | 低·推导 | 修法：teardown 前捕获原阶段与代次，为该 attempt 写一次看门狗失败，只抑制同一 attempt 的取消；文本仍遵守决策 051 |

Codex 核验 PARTIAL：armed 分支另经保护丢失上报 connectFail，不是所有卡住都只算取消。记录于 #1386。
