| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| A4-UPDATER-REVISION | Windows A4：更新器成功的应答不推进 PathPreference 修订号（`commands/update.rs` L151–166），在途的探测可能清掉刚证明可用的中继偏好 | open | [#1498](https://github.com/raydocs/tono/pull/1498)，评审回执 [1498#issuecomment-6097632776](https://github.com/raydocs/tono/pull/1498#issuecomment-6097632776) | 低·推导 | 后果是下一次发布 GET 多等一次直连超时；A1 的更新器顺序不变；未修，无修复 PR |

GPT-6 Astra（high）复审 #1498 @`11e3d36c` 的 2（minor），记 open 后合入（`a32d3fed`）。
