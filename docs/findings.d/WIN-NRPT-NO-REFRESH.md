| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-NRPT-NO-REFRESH | Windows NRPT 政策只写注册表，没有专门通知 DNS Client 重新加载 | open | 待开 | 低·实机 | Dnscache 是否沿用旧政策源码无法判定，需无 GPO 实机对照实验；只改顺序或 `ipconfig /registerdns` 都不能宣称已修 |

Codex 核验 NEEDS-HARDWARE。记录于 #1386。
