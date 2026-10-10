| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| A17W-MANUAL-RESELECT-RACE | Windows A17：自动尝试进行中时用户手选回 Reality 不生效——`commands/catalog.rs` 约 L250–265 对同一行返回 Noop 而不让在途尝试退役，`note_connected` 又恢复 `live_hy2` | open | [#1500](https://github.com/raydocs/tono/pull/1500)，评审回执 [1500#issuecomment-6097597180](https://github.com/raydocs/tono/pull/1500#issuecomment-6097597180) | 低·推导 | 只在 `hy2AutoSwitch` 为真时出现（默认关，按决定 081 / D1-C 只给内部账号开）；未修，无修复 PR |

GPT-6 Astra（high）复审 #1500 @`106c298c` 的 F2（minor），记 open 后合入（`a74bdc59`）。
