| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DNS-ENABLE-NO-FLUSH | Windows 非重放的 DNS enable 重钉政策后不清 DNS 缓存 | open | 待开 | 低·实机 | 普通应用是否沿用旧缓存、延迟多少需实机；候选修法是调用现有有界、best-effort 的 `engine_flush_cache` |

Codex 核验 NEEDS-HARDWARE。记录于 #1386。
