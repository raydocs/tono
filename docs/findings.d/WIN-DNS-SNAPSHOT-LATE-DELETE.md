| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DNS-SNAPSHOT-LATE-DELETE | Windows 取消后的 DNS 快照按路径删除仍在 blocking 线程里迟到执行，后继 enable 写到同一路径的新快照可能被删 | open | 待开 | 中·推导 | 修法须在受保护阶段取得旧快照的对象句柄并只按句柄删除，或用不可复用的世代标识；不能把 DNS 锁交给可能卡住的删除线程 |

Codex 核验 PARTIAL：后继快照可与旧快照字节相同，延后再比摘要仍可能删掉新快照。WIN-DNS-SNAPSHOT-DELETE-BLOCKS、WIN-DNS-RETIRED-SNAPSHOT-REPLAY 是相关的不同机制。记录于 #1386。
