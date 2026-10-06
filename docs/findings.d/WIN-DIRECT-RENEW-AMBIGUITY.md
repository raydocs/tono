| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DIRECT-RENEW-AMBIGUITY | Windows DIRECT 租约心跳把两次传输不确定的续租当成放行，并永久退出心跳，没有有界宽限 | fixed(574debe1) | [#1395](https://github.com/raydocs/tono/pull/1395) | 中·推导 | 宽限只覆盖没有 Service 判决的续租（类型 `DirectRenewalAmbiguous`），从上次获准续租的发送时刻起 40 秒内等下一拍（Service 租约至少到发送后 60 秒）；本心跳还没有获准续租时不给宽限；能救的只有 Service 仍持有租约时的瞬时传输失败，不跨 Service 重启（租约只在内存），排在长 WFP 操作后的续租也不在内（见 WIN-DIRECT-RENEW-QUEUE-EXPIRY）；单次 IPC 自身最长约 95 秒，超出即照旧处置；回归 `transport_ambiguity_grace_counts_from_the_granted_send` 只在 hosted CI 运行，未实机 |

Codex 核验 PARTIAL：Service release 先恢复 DNS、停本 owner Core，最后才释放 WFP，审查报告里「先放 WFP 再跑约 4 秒」不成立。WIN-DIRECT-RENEW-SELECTIVE（fixed bededbae）解决释放类别，不是宽限。记录于 #1386。

2026-10-05 三轮：按 Codex 的修法在 #1395 修复，见 [changelog](../changelog.d/2026-10-05-connection-audit-fixes-r2.md)。Codex high 复审 major：第一版从回复到达算宽限，回复慢时宽限可越过 Service 租约；已改为从获准续租的发送时刻算。复审另提「首拍无宽限会放行 strict 会话」：Windows 上没有 strict 的 DIRECT 会话（App 不设 strict，Service 布防固定写 false，只有 `emergency_armed()` 置 true 且不带 DIRECT），不成立；首拍照本 PR 之前的非 strict 处置。

2026-10-06 合入续记：[#1395](https://github.com/raydocs/tono/pull/1395) 以 `574debe1` 合入 main；精确 PR head 的 [ci-gate 37391874656](https://github.com/raydocs/tono/actions/runs/37391874656) 成功，独立 high-risk 覆盖见 PR close-out 评论。`fixed` 仅表示源码合入，不表示实机验收或客户发布。
