| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-NETWORK-CHANGE-DOUBLE-AUDIT | Windows 去抖暂缓的网络变化在暂缓那一拍和接纳那一拍各记一条 NetworkChange，同一变化在遥测里成两行 | in-PR | [#1386](https://github.com/raydocs/tono/pull/1386) | 低·已确认 | 恢复决策不变；日志关闭或队列满时的丢弃不受影响；回归未在本机运行 |

Codex 核验 PARTIAL：不是每次恰好两行，但可重复记录并形成重复行。WIN-DEBOUNCE-DROPS-EVENT（fixed 5b0f39db）修的是暂缓事件被消费，不覆盖重复日志。
