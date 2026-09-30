| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-QUOTA-CYCLE-INSERT-GAP | 过期周期关闭成功后新周期插入失败，下一轮用当前计数建基线，跨界流量漏计 | open | [#811](https://github.com/raydocs/tono/issues/811) | 中·推导 | 未改代码。#780 已让成功的新周期继承旧 last 计数。关闭与插入仍是两次 D1 写入 |

`rollNodeCycle`（`quota.ts` 307–316）先 `UPDATE` 关闭，再 `insertOpenCycle`。插入失败后没有 open 行，下次 `previous` 为空，271 行退回当前计数。成功路径上跨界区间整段归入新周期仍是 #780 的接受边界，不是本条。
