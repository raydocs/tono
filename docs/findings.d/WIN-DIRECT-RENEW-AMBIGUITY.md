| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DIRECT-RENEW-AMBIGUITY | Windows DIRECT 租约心跳把两次传输不确定的续租当成放行，并永久退出心跳，没有有界宽限 | in-PR | [#1395](https://github.com/raydocs/tono/pull/1395) | 中·推导 | 宽限只覆盖没有 Service 判决的续租（类型 `DirectRenewalAmbiguous`），从上次获准续租的发送时刻起 40 秒内等下一拍（Service 租约至少到发送后 60 秒）；本心跳还没有获准续租时不给宽限；单次 IPC 自身最长约 95 秒，超出即照旧处置；回归 `transport_ambiguity_grace_counts_from_the_granted_send` 只在 hosted CI 运行，未实机 |

Codex 核验 PARTIAL：Service release 先恢复 DNS、停本 owner Core，最后才释放 WFP，审查报告里「先放 WFP 再跑约 4 秒」不成立。WIN-DIRECT-RENEW-SELECTIVE（fixed bededbae）解决释放类别，不是宽限。记录于 #1386。

2026-10-05 三轮：按 Codex 的修法在 #1395 修复，见 [changelog](../changelog.d/2026-10-05-connection-audit-fixes-r2.md)。Codex high 复审 major：第一版从回复到达算宽限，回复慢时宽限可越过 Service 租约；已改为从获准续租的发送时刻算。
