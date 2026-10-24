| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| MAC-PREEMPTIVE-PARTIAL-VERIFIED | lockout 续修仅检查 PF/Core/DNS，在 AI 残留使终态 partial 时仍可能确认 update disconnect | in-PR | [#1740](https://github.com/raydocs/tono/pull/1740) R1 | 中·已确认（P2，本机 XCTest RED） | root 部分恢复接线测试待 CI；真实 AI 残留恢复未验证 |

来源 R1 对 `6c3a0be5f...b1c2ee773` 的第 1 条 P2。
修正证据：`apps/macos/Tono/Core/PreemptiveUpdateDisconnectProof.swift:11-17`；
`tooling/scripts/core-helper/ReleaseWorker.swift` 的 Reporter.terminalOutcome 与 markUpdateDisconnectVerified。
RED `e4afdbba8` 1 项/1 失败；GREEN `f91689a31` 更新/证明窄套件 23 项/0 失败。
终态 outcome 必须显式传入且等于 restored；未知/部分恢复都不确认。
