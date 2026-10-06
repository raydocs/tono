| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-HEALTH-AUTO-CITY-SWITCH | macOS 健康监控连续两次失败后自动换到并持久化下一个城市，违反 SHIP_PLAN G2.8 关闭自动换城 | fixed(e37e11b4) | [#1386](https://github.com/raydocs/tono/pull/1386) | 中·已确认 | 坏出口改走原有 re-arm/升级与自动放行；回归未在本机运行；未实机验证 |

Codex 核验 CONFIRMED。MAC-HEALTH-STALE-ROUTE（#1376）是旧探测归属问题，不覆盖这个入口。

2026-10-06 合入续记：[#1386](https://github.com/raydocs/tono/pull/1386) 以 `e37e11b4` 合入 main；精确 PR head 的 [ci-gate 37427132996](https://github.com/raydocs/tono/actions/runs/37427132996) 成功，独立 high-risk 覆盖见 PR close-out 评论。`fixed` 仅表示源码合入，不表示实机验收或客户发布。
