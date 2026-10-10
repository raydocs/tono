| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| A4-STARTUP-CACHE-OVERWRITE | Windows A4：启动时采用路径缓存的修订号是在等完凭据 / pin 加载之后才取的（`path_probe.rs` L103–107 / `commands/restore.rs` L1075–1088），这期间登录已走通中继的偏好会被仍有效的缓存 `pinned` 覆盖 | open | [#1498](https://github.com/raydocs/tono/pull/1498)，评审回执 [1498#issuecomment-6097632776](https://github.com/raydocs/tono/pull/1498#issuecomment-6097632776) | 低·推导 | 后果是下一个请求多付一次直连死路径的超时预算；不影响身份或放行；未修，无修复 PR |

GPT-6 Astra（high）复审 #1498 @`11e3d36c` 的 1（minor），该 PR 的一轮 minor 修复已用完，记 open 后合入（`a32d3fed`）。
