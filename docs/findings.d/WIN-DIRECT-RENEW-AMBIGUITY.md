| ID | 问题（一句） | 状态 | Issue / PR | 等级 | 剩余限制 |
|---|---|---|---|---|---|
| WIN-DIRECT-RENEW-AMBIGUITY | Windows DIRECT 租约心跳把两次传输不确定的续租当成放行，并永久退出心跳，没有有界宽限 | open | 待开 | 中·推导 | 修法：类型化区分传输不确定与权威拒绝，只给前者单调时钟下的有界宽限，保留代次、策略、会话校验和 Service 到期回收 |

Codex 核验 PARTIAL：Service release 先恢复 DNS、停本 owner Core，最后才释放 WFP，审查报告里「先放 WFP 再跑约 4 秒」不成立。WIN-DIRECT-RENEW-SELECTIVE（fixed bededbae）解决释放类别，不是宽限。记录于 #1386。
