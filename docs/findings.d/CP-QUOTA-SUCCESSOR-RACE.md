| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CP-QUOTA-SUCCESSOR-RACE | 配额跨周期新建 successor 行时，两个并发采样可把同一段流量算两次并误记一次 reset | open | 待开 | 低·推导 | 仅在周期切换瞬间、同一节点两份采样并发时出现；多算，不少算（不会漏计超额） |

来源：同一次部署前 Codex 范围评审。`ops/quota-cycle.ts:87`、`ops/quota.ts:293,317`：A 采样 150 后创建 successor；B 在 A 的回读之前把 successor 从 100 更新到 200（累计 100）；A 读到 B 的新行，把自己的旧采样判为 reset，CAS 仍成功。内存 SQL 结果 `used_bytes=250, resets_detected=1`，实际增量 100。#1181 的防护不覆盖这个窗口。不阻塞部署：方向是多算（更早告警），不影响放行或计费账本。
