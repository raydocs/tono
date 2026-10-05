| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-RESUME-RECEIPT-RACE | Windows Service 在 T0 决定保留已证明 Core 却只返回终止数量，App 在 T1 重新采样 resume 状态，采样失败时把自家 Core 占用的 :53 报成别的 DNS 软件冲突并失败 | open | 待开 | 中·推导 | 稳健修法是带 owner/attempt/Core 身份、兼容旧 Service 的保留回执，只授权自占 :53 例外，仍需 StartClash 与完整验证；与 WIN-RESUME-DNS-PROBE-WAIT 共用回执 |

Codex 核验 PARTIAL。R2-F6（fixed b1b6fe6c）修的是迟到 Prepare 跨代次停 Core，不是双采样不一致。记录于 #1386。
