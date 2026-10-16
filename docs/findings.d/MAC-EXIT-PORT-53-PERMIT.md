| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-EXIT-PORT-53-PERMIT | Mac helper 的出口端点接受任意正数端口（含 53/853），并渲染 root 的物理接口出站放行，所以“任何规则集里物理接口都没有 53/853 的 pass”并非字面保证 | open | [#1591](https://github.com/raydocs/tono/pull/1591) 审查记录 | 中·推导 | 所有者决定；本 PR 未改 |

Codex 审查 #1591（第 1、2 轮）记录的既有残余，不是本 PR 引入。位置：`KillSwitchManager.swift` 约 1978–1990 行（端点校验只要求 `port > 0`），`KillSwitchPF.swift` 约 511–519 行（`tono-exit` 放行）。建议修法：在 helper 边界和控制面目录校验里拒绝 53/853 作为出口端口（是否同时拒绝 1024 以下由所有者定）。
