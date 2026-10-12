| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| A17W-FALLBACK-SNAPSHOT | Windows A17：目录变化后的回退把新的 WFP 端点和旧的运行时快照混在一起编译（`heal.rs` 约 L156–172 对 `connection.rs` L501–513 / `stages.rs` L255–280），回退因此失败 | open | [#1500](https://github.com/raydocs/tono/pull/1500)，评审回执 [1500#issuecomment-6097597180](https://github.com/raydocs/tono/pull/1500#issuecomment-6097597180) | 低·推导 | 只在 `hy2AutoSwitch` 为真时出现（默认关，按决定 081 / D1-C 只给内部账号开）；回退失败时 fail-closed，不放行；未修，无修复 PR |

GPT-6 Astra（high）复审 #1500 @`106c298c` 的 F4（minor），记 open 后合入（`a74bdc59`）。
