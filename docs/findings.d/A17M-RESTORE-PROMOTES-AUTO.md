| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| A17M-RESTORE-PROMOTES-AUTO | macOS A17：恢复 Reality 选择时忽略 `applyProxySelection` 失败（`AppState+Hy2AutoSwitch.swift` L9–11），且 `Hy2AutoSwitch.swift` L159–163 先清 `activeDial`；若之后的目录去掉 A 的 Reality 块却保留 `A · hy2`（并把开关设为假），下次连接拨 A·hy2 并当作用户手选持久化 | open | [#1499](https://github.com/raydocs/tono/pull/1499)，评审回执 [1499#issuecomment-6097518639](https://github.com/raydocs/tono/pull/1499#issuecomment-6097518639) | 低·推导 | 需要违反 catalog-yaml 不变量（hy2 是同一节点的第二个块）的目录形状才触发；读码推导，未复现；未修，无修复 PR |

GPT-6 Astra（high）复审 #1499 @`411f6281` 的 F4（minor），该 PR 的一轮 minor 修复已用完，记 open 后合入（`13bdfc13`）。
