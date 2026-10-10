| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| A17W-REVOKE-BEFORE-START | Windows A17：开关撤销的复查在 `run_stages` 的 await 之前做完（`connection.rs` 约 L494–519），PrepareCoreStart 期间到达只撤开关的 200 不会让本代连接退役，已捕获的自动 hy2 跳仍会启动 | open | [#1500](https://github.com/raydocs/tono/pull/1500)，评审回执 [1500#issuecomment-6097597180](https://github.com/raydocs/tono/pull/1500#issuecomment-6097597180) | 低·推导 | 只在 `hy2AutoSwitch` 为真时出现（默认关，按决定 081 / D1-C 只给内部账号开）；未修，无修复 PR；评审只读码未复现 |

GPT-6 Astra（high）复审 #1500 @`106c298c` 的 F1（minor），该 PR 的一轮 minor 修复已用完，按 AGENTS 停止规则记 open 后合入（`a74bdc59`）。
