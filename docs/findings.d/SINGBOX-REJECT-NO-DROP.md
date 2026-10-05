| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| SINGBOX-REJECT-NO-DROP | 两端 sing-box 的助手与末尾 reject 规则没有 `no_drop`，短时大量命中后可能转为静默丢弃，应用回退变慢 | open | 待开 | 低·实机 | 计数阈值与收益需用当前 pinned core 实测；修法只给既有 reject 加 `no_drop`，不新增路由或许可 |

Codex 核验 NEEDS-HARDWARE。记录于 #1386。
