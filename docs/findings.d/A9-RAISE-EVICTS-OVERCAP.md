| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| A9-RAISE-EVICTS-OVERCAP | 调高设备上限也会踢设备：对本修复前就已超额的账户（如 5 台在线时上限从 5 调到 1），把上限调到 3 会按 LRU 撤销两台——`token-admin.ts` 约 L148–149 只要带了 `deviceLimit` 就执行驱逐，不看是否调低 | in-PR | [#1487](https://github.com/raydocs/tono/pull/1487)，评审回执 [1487#issuecomment-6097307426](https://github.com/raydocs/tono/pull/1487#issuecomment-6097307426)；修复分支 `amp/a9-raise-evicts-overcap`（ea531f48） | 低·已确认 | 修复：同一 D1 批次里先选驱逐对象、再写上限，选择条件是新值小于当时库里的旧值，调高或不变不驱逐（遗留超额账户等下次登录追上）；回归在 `worker-devices.test.ts` 现有 `it` 里（5 台在线、库内上限 1、PATCH 到 3 → 不撤销）；控制面未部署 |

GPT-6 Astra（high）评审 #1487 @`08755122` 的 minor（一次性复现：期望 5，实得 3），该 PR 的一轮 minor 修复已用完，记 open 后合入（`9bc77231`）。H17-C-F1 的「剩余限制」指向本条。

2026-10-10 续：分支 `amp/a9-raise-evicts-overcap` 修复，状态 in-PR；改前同一回归失败（期望 5 台在线，实得 3），改后通过。
