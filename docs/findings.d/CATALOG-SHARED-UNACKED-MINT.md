| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| CATALOG-SHARED-UNACKED-MINT | 设备凭据未就绪时，目录退回账户共享 UUID，这个 UUID 可能刚铸造、没有任何出口确认过，就被下发 | fixed(3c9f3923) | #1379 | 中·已确认 | 只修控制面；客户端必须同时带上 CLIENT-PROPAGATING-SLOW-RETRY，否则新设备的 Windows 要等 300 秒；一个已发布出口停止确认名册时，没有已确认共享凭据的账户会一直 503，直到它恢复或下架 |

`services/control-plane/src/catalog.ts` 的 `exitClientUUID` 在 deviceId 分支里，设备凭据没被全部出口确认、处于 dual 阶段且共享凭据未退休时，递归调用 `exitClientUUID(e, userId, null)`。这条路径查不到共享凭据就当场铸造一个，然后直接下发，不检查任何出口是否已经装上它（原注释说认证目录不会走到铸造，实际会走到）。新账户第一次拉目录拿到的是出口还不认识的 UUID，第一次连接在大多数出口上 VLESS 认证失败，直到下一轮出口对账。

修复：共享凭据也走同一条就绪判定（本次下发的每个出口 `last_roster_at > created_at`）。缺失或未就绪返回 503 `EXIT_IDENTITY_PROPAGATING`，这里不再铸造。已退休和 device_only 的「不回退」规则不变（决策 055）。回归：`worker.test.ts` 的 `never serves a new dual account an exit identity no served exit has acknowledged`。

2026-10-06 合入续记：[#1379](https://github.com/raydocs/tono/pull/1379) 以 `3c9f3923` 合入 main；精确 PR head 的 [ci-gate 37427128341](https://github.com/raydocs/tono/actions/runs/37427128341) 成功，独立 high-risk 覆盖见 PR close-out 评论。`fixed` 仅表示源码合入，不表示实机验收或客户发布。
