| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| A9-RAISE-EVICTS-OVERCAP | 调高设备上限也会踢设备：对本修复前就已超额的账户（如 5 台在线时上限从 5 调到 1），把上限调到 3 会按 LRU 撤销两台——`token-admin.ts` 约 L148–149 只要带了 `deviceLimit` 就执行驱逐，不看是否调低 | open | [#1487](https://github.com/raydocs/tono/pull/1487)，评审回执 [1487#issuecomment-6097307426](https://github.com/raydocs/tono/pull/1487#issuecomment-6097307426) | 低·已确认 | 效果是对遗留超额账户执行已存的上限，不扩大权限、不跨账户；可选修法：只在新值小于旧值时驱逐；控制面未部署；未修，无修复 PR |

GPT-6 Astra（high）评审 #1487 @`08755122` 的 minor（一次性复现：期望 5，实得 3），该 PR 的一轮 minor 修复已用完，记 open 后合入（`9bc77231`）。H17-C-F1 的「剩余限制」指向本条。
