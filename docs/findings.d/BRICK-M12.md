| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| BRICK-M12 | macOS DNS 恢复清扫把 Tono 从没改过的服务上正好是 `[127.0.0.1]` 的 DNS 也清掉（`ProtectedDNSManager.swift:295-311`） | in-PR | [#712](https://github.com/raydocs/tono/pull/712) | 低·推导 | 有快照时只改快照里的那个服务。快照损坏时的无主清扫仍在，否则紧急恢复会留着死解析。没记在快照里、但其实是 Tono 写过的禁用网卡，重新启用后仍可能是 `127.0.0.1`。需实机 |

来源：brick 审计 2026-09-28（基线 origin/main `c0e7758e`），codex MAC-3；延后记录。
