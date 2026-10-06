| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HEALTH-AUTO-CITY-SWITCH | macOS 健康监控连续两次失败后自动换到并持久化下一个城市，违反 SHIP_PLAN G2.8 关闭自动换城 | in-PR | [#1386](https://github.com/raydocs/tono/pull/1386) | 中·已确认 | 坏出口改走原有 re-arm/升级与自动放行；回归未在本机运行；未实机验证 |

Codex 核验 CONFIRMED。MAC-HEALTH-STALE-ROUTE（#1376）是旧探测归属问题，不覆盖这个入口。
