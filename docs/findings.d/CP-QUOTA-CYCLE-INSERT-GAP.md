| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-QUOTA-CYCLE-INSERT-GAP | 过期周期关闭成功后新周期插入失败，下一轮用当前计数建基线，跨界流量漏计 | fixed(827f020e) | [#811](https://github.com/raydocs/tono/issues/811) [#852](https://github.com/raydocs/tono/pull/852) [#904](https://github.com/raydocs/tono/pull/904) | 中·推导 | #852 把关闭与插入合成一次批处理，#904 不再在没有样本时把基线记成零；未部署 |

`rollNodeCycle`（`quota.ts` 307–316）先 `UPDATE` 关闭，再 `insertOpenCycle`。插入失败后没有 open 行，下次 `previous` 为空，271 行退回当前计数。成功路径上跨界区间整段归入新周期仍是 #780 的接受边界，不是本条。
