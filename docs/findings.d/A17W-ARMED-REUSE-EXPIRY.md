| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| A17W-ARMED-REUSE-EXPIRY | Windows A17：armed 状态原地复用（`hy2_switch.rs` 约 L318–333 `live_dial`）从不检查 24 h 过期，一直在保护中反复重连的会话永远不再回试 Reality | open | [#1500](https://github.com/raydocs/tono/pull/1500)，评审回执 [1500#issuecomment-6097597180](https://github.com/raydocs/tono/pull/1500#issuecomment-6097597180) | 低·推导 | 只在 `hy2AutoSwitch` 为真时出现（默认关，按决定 081 / D1-C 只给内部账号开）；未修，无修复 PR |

GPT-6 Astra（high）复审 #1500 @`106c298c` 的 F3（minor），记 open 后合入（`a74bdc59`）。
