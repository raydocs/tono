| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M12 | macOS DNS 恢复清扫把 Tono 从没改过的服务上正好是 `[127.0.0.1]` 的 DNS 也清掉（`ProtectedDNSManager.swift:295-311`） | open | 待开 | 低·推导 | 未修；loopback 地址不足以证明归属；brick 审计延后项 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），codex MAC-3；延后记录。
